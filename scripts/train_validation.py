"""Train/evaluate ONLY from owner-reviewed, sourced labels.

No sourced labels => NO fitted model, NO accuracy claim. Cross-validation is
held out by geographic site_group to reduce pixel-level leakage.
"""
import argparse
import json
from collections import Counter,defaultdict
from pathlib import Path
import numpy as np
from PIL import Image

CLASSES=("construction","agriculture","unchanged")
MIN_PER_CLASS=6
MIN_GROUPS_PER_CLASS=3

def samples_from_npz(npz, rows):
    x,y,accepted=[],[],[]
    shape=npz["worldcover"].shape
    for record in rows:
        row,col=int(record["row"]),int(record["col"])
        if not(0<=row<shape[0] and 0<=col<shape[1]):
            continue
        if not bool(npz["joint_valid"][row,col]):
            continue
        values=[]
        for i in range(4):
            for key in ("ndvi","bsi","ndbi"):
                values.append(float(npz[f"{key}_{i}"][row,col]))
        if not np.isfinite(values).all():
            continue
        values.extend([values[3]-values[0],values[6]-values[3],
                       values[9]-values[6],values[4]-values[1],
                       values[10]-values[4]])
        x.append(values)
        y.append(record["label"])
        accepted.append(record)
    if not x:
        return np.empty((0,17)),np.array([]),[]
    return np.array(x,dtype=np.float32),np.array(y),accepted


def deduplicate_annotations(rows):
    """Remove duplicate points and entirely exclude conflicting human labels."""
    buckets=defaultdict(list)
    for r in rows:
        buckets[(int(r["row"]),int(r["col"]))].append(r)
    unique=[]
    conflicts=[]
    for pixel,records in buckets.items():
        if len(set(r["label"] for r in records))>1:
            conflicts.append(pixel)
            continue
        unique.append(records[0])
    return unique,conflicts

def spatial_site_groups(rows,block_pixels=25):
    """Merge rows connected by 250m grid block OR owner-declared physical site.

    Prevents easily inflated test accuracy by assigning adjacent pixels
    different user-chosen site names. The geographic blocks remain SMALL:
    this is a local research holdout, not regional generalisation testing.
    """
    parent=list(range(len(rows)))
    def find(x):
        while parent[x]!=x:
            parent[x]=parent[parent[x]]
            x=parent[x]
        return x
    def union(a,b):
        x,y=find(a),find(b)
        if x!=y:parent[y]=x
    by_block={}
    by_site={}
    for i,r in enumerate(rows):
        key=(int(r["row"])//block_pixels,int(r["col"])//block_pixels)
        site=str(r["site_group"])
        if key in by_block: union(i,by_block[key])
        else:by_block[key]=i
        if site in by_site:union(i,by_site[site])
        else:by_site[site]=i
    return [f"combined_spatial_group_{find(i)}" for i in range(len(rows))]

def site_group_split(y,group_names):
    """Require each class to occur in multiple distinct train/test sites."""
    from sklearn.model_selection import GroupShuffleSplit
    classes=set(CLASSES)
    for seed in range(150):
        splitter=GroupShuffleSplit(n_splits=1,test_size=.34,random_state=seed)
        train,test=next(splitter.split(np.zeros(len(y)),y,group_names))
        if set(y[train])==classes and set(y[test])==classes:
            return train,test,seed
    raise RuntimeError("Could not create a site-group-disjoint split covering all classes")

def produce(features,labels,out,overlay):
    output=Path(out)
    output.parent.mkdir(parents=True,exist_ok=True)
    def save(value):
        output.write_text(json.dumps(value,indent=2,ensure_ascii=False),encoding="utf-8")
        return value
    with np.load(features,allow_pickle=False) as pack:
        signature=str(pack["signature"].item())
        study_id=str(pack["study_id"].item())
        label_file=Path(labels)
        rows=[]
        if label_file.exists():
            for ln,line in enumerate(label_file.read_text(encoding="utf-8").splitlines(),1):
                if not line.strip():
                    continue
                try:
                    r=json.loads(line)
                    if (r.get("label") in CLASSES and r.get("signature")==signature
                        and r.get("study_id")==study_id and r.get("reviewed_by")
                        and r.get("evidence_url") and
                        r.get("question_version")=="change-types-v2"):
                        rows.append(r)
                except (ValueError,TypeError) as e:
                    print(f"Invalid labeled line {ln}: {e}")
        rows,conflict_pixels=deduplicate_annotations(rows)
        x,y,accepted=samples_from_npz(pack,rows)
        geographic_groups=spatial_site_groups(accepted)
        sites=defaultdict(set)
        for r,g in zip(accepted,geographic_groups):
            sites[r["label"]].add(g)
        counts=dict(Counter(y))
        groups={c:len(sites[c]) for c in CLASSES}
        base={"study_id":study_id,"signature":signature,
              "ground_truth_label_count":int(len(y)),
              "counts_by_class":{c:int(counts.get(c,0)) for c in CLASSES},
              "independent_groups_by_class":groups,
              "minimum_samples_per_class":MIN_PER_CLASS,
              "minimum_geographic_groups_per_class":MIN_GROUPS_PER_CLASS,
              "validation_type":"owner_site_plus_250m_geographic_block_holdout",
              "conflicting_label_pixels_excluded":len(conflict_pixels),
              "spatial_blocks_m":250,
              "can_claim_global_performance":False,
              "training_data_source":"Owner-reviewed GitHub issue labels with dated, independent evidence URL",
              "never_train_on_unsourced_labels":True}
        if any(counts.get(c,0)<MIN_PER_CLASS or groups[c]<MIN_GROUPS_PER_CLASS for c in CLASSES):
            base.update(status="needs_labels",
              message="Not enough sourced, owner-reviewed sites in all three classes. No model was fitted.",
              accuracy=None,precision=None,recall=None,confusion_matrix=None)
            return save(base)
        try:
            train,test,seed=site_group_split(y,geographic_groups)
        except RuntimeError as e:
            base.update(status="insufficient_groups",message=str(e),
                        accuracy=None,precision=None,recall=None,confusion_matrix=None)
            return save(base)
        from sklearn.ensemble import RandomForestClassifier
        from sklearn.metrics import confusion_matrix,classification_report,balanced_accuracy_score
        clf=RandomForestClassifier(n_estimators=160,max_depth=8,min_samples_leaf=2,
                                   class_weight="balanced_subsample",random_state=42,n_jobs=2)
        clf.fit(x[train],y[train])
        predicted=clf.predict(x[test])
        scores=classification_report(y[test],predicted,labels=CLASSES,
                                     output_dict=True,zero_division=0)
        matrix=confusion_matrix(y[test],predicted,labels=CLASSES).tolist()
        base.update(
            status="experimental_model",
            warning="Tiny labeled dataset; metrics only apply to these held-out sites, NOT other cities.",
            n_train=int(len(train)),n_test=int(len(test)),
            group_split_seed=int(seed),
            train_site_groups=sorted(set(geographic_groups[i] for i in train)),
            test_site_groups=sorted(set(geographic_groups[i] for i in test)),
            class_names=list(CLASSES),confusion_matrix=matrix,
            balanced_accuracy=round(float(balanced_accuracy_score(y[test],predicted)),3),
            precision={k:round(float(scores[k]["precision"]),3) for k in CLASSES},
            recall={k:round(float(scores[k]["recall"]),3) for k in CLASSES},
            support={k:int(scores[k]["support"]) for k in CLASSES})
        # Only when validation prerequisites are satisfied, render a
        # preview. Pixels without all four clear scenes remain transparent.
        good=np.asarray(pack["joint_valid"],dtype=bool) & np.asarray(pack["corridor"],dtype=bool)
        r,c=np.where(good)
        feats=[]
        for j in range(4):
            for key in ("ndvi","bsi","ndbi"):
                feats.append(pack[f"{key}_{j}"][r,c])
        f=np.column_stack(feats)
        f=np.column_stack([f,f[:,3]-f[:,0],f[:,6]-f[:,3],
                           f[:,9]-f[:,6],f[:,4]-f[:,1],f[:,10]-f[:,4]])
        pred=clf.predict(f)
        overlay_data=np.zeros((*good.shape,4),dtype=np.uint8)
        colors={"construction":(56,220,183,150),
                "agriculture":(112,146,238,150),"unchanged":(210,180,70,90)}
        for name,color in colors.items():
            use=pred==name
            overlay_data[r[use],c[use]]=color
        Image.fromarray(overlay_data,"RGBA").save(overlay,optimize=True)
        return save(base)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--features",default="site/features_v05.npz")
    p.add_argument("--labels",default="labels/reviewed.jsonl")
    p.add_argument("--output",default="site/validation_v05.json")
    p.add_argument("--overlay",default="site/model_predictions_v05.png")
    a=p.parse_args()
    result=produce(a.features,a.labels,a.output,a.overlay)
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=="__main__":
    main()
