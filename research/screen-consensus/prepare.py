#!/usr/bin/env python3
"""Build the strict GDSC1 x GDSC2 x PRISM drug/cell overlap table.

Usage: python prepare.py CACHE

Inputs (pinned in sources.json, stored flat in CACHE, downloaded if absent):
  GDSC1/GDSC2 fitted dose response, release 8.5 (27Oct23), AUC
  PRISM Repurposing 19Q4 secondary-screen dose-response curve parameters, auc
  DepMap 19Q4 sample_info.csv (official DepMap_ID <-> COSMIC_ID <-> Sanger model ID)

Outputs in CACHE:
  matched.csv         drug,cell,tissue,gdsc1,gdsc2,prism   (AUC; lower = more sensitive in all three)
  cell_crosswalk.csv  matched cells: ACH id <-> GDSC / PRISM / DepMap identifiers
  drug_crosswalk.csv  matched drugs: name <-> GDSC1/GDSC2 DRUG_ID and PRISM broad_id
  drug_audit.csv      every drug name seen in any source with its inclusion/exclusion reason
  cell_audit.csv      every GDSC cell and PRISM cell with its inclusion/exclusion reason
  prepare_report.json source pins plus the full exclusion flow and summary statistics

Identity rules (no guesses):
  cells  GDSC cell -> DepMap ID via COSMIC_ID and via SANGER_MODEL_ID. Both routes must agree when
         both resolve, and the DepMap record must not contradict the GDSC COSMIC/Sanger ID. The
         mapping must be one-to-one. Cell names are audited, never used to match.
  drugs  exact name match after casefold + whitespace collapse only (no punctuation/salt stripping).
         A name with several GDSC DRUG_IDs inside one GDSC dataset, or several PRISM compounds
         (Broad ID core BRD-Kxxxxxxxx), or several PRISM batches in the chosen screen, is excluded.
         Synonym and punctuation-insensitive candidates are only reported in drug_audit.csv.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import urllib.request

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCES = os.path.join(HERE, "sources.json")
# PRISM screens used, in precedence order. MTS010 is the README-recommended redo of 147 oncology
# compounds; HTS002 is the main secondary screen. MTS005/MTS006 are not described in the README.
PRISM_SCREENS = ("MTS010", "HTS002")
GDSC_KEEP = ["DATASET", "COSMIC_ID", "CELL_LINE_NAME", "SANGER_MODEL_ID", "TCGA_DESC",
             "DRUG_ID", "DRUG_NAME", "AUC"]


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def md5_of(path):
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 23), b""):
            h.update(chunk)
    return h.hexdigest()


def ensure(cache, key, entry):
    path = os.path.join(cache, entry["local"])
    if os.path.exists(path):
        got = md5_of(path)
        if got != entry["md5"]:
            sys.exit(f"{path}: md5 {got} != pinned {entry['md5']} ({key}); refusing to use it")
        return path
    log(f"downloading {entry['url']}")
    part = path + ".part"
    req = urllib.request.Request(entry["url"], headers={"User-Agent": "cell-lab-prepare/1"})
    with urllib.request.urlopen(req) as r, open(part, "wb") as out:
        while chunk := r.read(1 << 20):
            out.write(chunk)
    got = md5_of(part)
    if got != entry["md5"] or os.path.getsize(part) != entry["size"]:
        os.remove(part)
        sys.exit(f"{key}: downloaded md5 {got} / size mismatch vs pin")
    os.replace(part, path)
    return path


def read_gdsc(cache, key, entry, path):
    """Read the xlsx once (slow), keep a reduced CSV cache keyed by the pinned md5."""
    red = os.path.join(cache, f"{key}.{entry['md5'][:8]}.reduced.csv")
    if os.path.exists(red):
        return pd.read_csv(red, dtype={"SANGER_MODEL_ID": "string", "CELL_LINE_NAME": "string",
                                       "TCGA_DESC": "string", "DRUG_NAME": "string",
                                       "DATASET": "string"})
    import openpyxl
    log(f"reading {path} (openpyxl read_only; slow, cached afterwards)")
    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb.worksheets[0]
    ws.reset_dimensions()  # the sheet declares a bogus dimension; this makes iteration complete
    it = ws.iter_rows(values_only=True)
    header = list(next(it))
    idx = [header.index(c) for c in GDSC_KEEP]
    rows = [tuple(r[i] for i in idx) for r in it]
    wb.close()
    df = pd.DataFrame(rows, columns=GDSC_KEEP)
    df.to_csv(red + ".part", index=False)
    os.replace(red + ".part", red)
    return df


def fold(x):
    return " ".join(str(x).casefold().split())


def alnum(x):
    return re.sub(r"[^a-z0-9]", "", str(x).casefold())


def prep_gdsc(df, label, flow):
    n0 = len(df)
    assert df["DATASET"].eq(label.upper()).all(), f"{label}: unexpected DATASET values"
    df = df.copy()
    flow[f"{label}_rows"] = n0
    flow[f"{label}_rows_missing_auc"] = int(df["AUC"].isna().sum())
    df = df[df["AUC"].notna()]
    assert not df.duplicated(["DRUG_ID", "COSMIC_ID"]).any(), f"{label}: duplicate DRUG_ID x COSMIC_ID"
    assert df.groupby("DRUG_ID")["DRUG_NAME"].nunique().max() == 1, f"{label}: DRUG_ID with several names"
    df["drug"] = df["DRUG_NAME"].map(fold)
    return df


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cache", help="cache directory (outside the repo); created if absent")
    cache = os.path.abspath(os.path.expanduser(ap.parse_args().cache))
    os.makedirs(cache, exist_ok=True)

    with open(SOURCES) as f:
        src = json.load(f)["files"]
    paths = {k: ensure(cache, k, v) for k, v in src.items()}
    flow = {}

    # ------------------------------------------------------------------ load
    g = {}
    for key, label in (("gdsc1", "gdsc1"), ("gdsc2", "gdsc2")):
        g[label] = prep_gdsc(read_gdsc(cache, key, src[key], paths[key]), label, flow)
    pr = pd.read_csv(paths["prism_dose"], low_memory=False,
                     usecols=["broad_id", "depmap_id", "ccle_name", "screen_id", "auc", "r2",
                              "name", "passed_str_profiling"])
    ds = pd.read_csv(paths["depmap_sample_info"], low_memory=False,
                     usecols=["DepMap_ID", "stripped_cell_line_name", "CCLE_Name", "COSMIC_ID",
                              "Sanger_model_ID"])
    comp = pd.read_csv(paths["gdsc_compounds"])
    assert ds["DepMap_ID"].is_unique
    ds["COSMIC_ID"] = ds["COSMIC_ID"].astype("Int64")
    assert ds["COSMIC_ID"].dropna().is_unique and ds["Sanger_model_ID"].dropna().is_unique

    # ================================================================== CELLS
    # --- GDSC cell table (union of GDSC1/GDSC2); attributes must agree across datasets
    gall = pd.concat([g["gdsc1"], g["gdsc2"]], ignore_index=True)
    cell_attr = gall.groupby("COSMIC_ID").agg(
        gdsc_cell_name=("CELL_LINE_NAME", lambda s: "|".join(sorted(set(s.dropna())))),
        sanger_model_id=("SANGER_MODEL_ID", lambda s: "|".join(sorted(set(s.dropna())))),
        tcga=("TCGA_DESC", lambda s: sorted(set(s.dropna()))),
    ).reset_index()
    flow["gdsc_cells_total"] = len(cell_attr)
    flow["gdsc_cells_inconsistent_name_or_sidm_between_datasets"] = int(
        cell_attr["gdsc_cell_name"].str.contains(r"\|").sum()
        + cell_attr["sanger_model_id"].str.contains(r"\|").sum())
    assert flow["gdsc_cells_inconsistent_name_or_sidm_between_datasets"] == 0
    cell_attr["sanger_model_id"] = cell_attr["sanger_model_id"].replace("", pd.NA)

    def tissue_of(vals):
        vals = [v for v in vals if v.upper() != "UNCLASSIFIED"]
        return vals[0] if len(vals) == 1 else "unknown"
    cell_attr["tissue"] = cell_attr["tcga"].map(tissue_of)
    flow["gdsc_cells_tissue_unknown"] = int((cell_attr["tissue"] == "unknown").sum())

    # --- GDSC -> DepMap via two official identifiers
    by_cos = ds.dropna(subset=["COSMIC_ID"]).set_index("COSMIC_ID")["DepMap_ID"]
    by_sidm = ds.dropna(subset=["Sanger_model_ID"]).set_index("Sanger_model_ID")["DepMap_ID"]
    ds_i = ds.set_index("DepMap_ID")
    cell_attr["ach_cosmic"] = cell_attr["COSMIC_ID"].map(by_cos)
    cell_attr["ach_sidm"] = cell_attr["sanger_model_id"].map(by_sidm)

    def resolve(r):
        a, b = r["ach_cosmic"], r["ach_sidm"]
        cands = {x for x in (a, b) if pd.notna(x)}
        if not cands:
            return pd.Series([pd.NA, "no_depmap_record_for_cosmic_or_sanger_id", pd.NA])
        if len(cands) > 1:
            return pd.Series([pd.NA, "conflict_cosmic_vs_sanger_route", pd.NA])
        ach = cands.pop()
        rec = ds_i.loc[ach]
        if pd.notna(rec["COSMIC_ID"]) and rec["COSMIC_ID"] != r["COSMIC_ID"]:
            return pd.Series([pd.NA, "conflict_depmap_record_has_other_cosmic_id", pd.NA])
        if pd.notna(rec["Sanger_model_ID"]) and pd.notna(r["sanger_model_id"]) \
                and rec["Sanger_model_ID"] != r["sanger_model_id"]:
            return pd.Series([pd.NA, "conflict_depmap_record_has_other_sanger_id", pd.NA])
        route = "cosmic+sanger" if pd.notna(a) and pd.notna(b) else (
            "cosmic_only" if pd.notna(a) else "sanger_only")
        return pd.Series([ach, "mapped", route])
    cell_attr[["cell", "cell_status", "route"]] = cell_attr.apply(resolve, axis=1)
    # one-to-one: several GDSC cells -> one ACH is ambiguous for all of them
    dup = cell_attr["cell"].notna() & cell_attr["cell"].duplicated(keep=False)
    cell_attr.loc[dup, ["cell_status", "cell", "route"]] = ["conflict_several_gdsc_cells_one_depmap_id", pd.NA, pd.NA]
    flow["gdsc_cells_status"] = cell_attr["cell_status"].value_counts().to_dict()
    flow["gdsc_cells_mapped_route"] = cell_attr["route"].value_counts().to_dict()

    # --- PRISM cells
    flow["prism_dose_rows"] = len(pr)
    flow["prism_dose_rows_failed_str"] = int((~pr["passed_str_profiling"]).sum())
    flow["prism_dose_cells_failed_str_rows_have_missing_depmap_id"] = int(
        pr.loc[~pr["passed_str_profiling"], "depmap_id"].isna().all())
    pr = pr[pr["passed_str_profiling"]]
    assert pr["depmap_id"].notna().all() and pr["auc"].notna().all()
    flow["prism_dose_rows_after_str"] = len(pr)
    cinfo = pd.read_csv(paths["prism_cell_info"], low_memory=False)
    flow["prism_cell_info_rows"] = len(cinfo)
    flow["prism_cell_info_failed_str"] = int((cinfo["passed_str_profiling"] == False).sum())  # noqa: E712
    flow["prism_cell_info_control_barcodes"] = int(cinfo["row_name"].str.startswith("CONTROL_BARCODE").sum())
    names_per_ach = pr.groupby("depmap_id")["ccle_name"].agg(lambda s: sorted(set(s)))
    pr_cells = pd.DataFrame({"cell": names_per_ach.index,
                             "prism_ccle_name": names_per_ach.map("|".join).values,
                             "n_ccle_names": names_per_ach.map(len).values})
    flow["prism_cells_after_str"] = len(pr_cells)
    amb_prism_cells = set(pr_cells.loc[pr_cells["n_ccle_names"] > 1, "cell"])
    flow["prism_cells_ambiguous_several_ccle_names"] = sorted(amb_prism_cells)
    pr_cells["prism_status"] = ["ambiguous_several_ccle_names" if n > 1 else "ok" for n in pr_cells["n_ccle_names"]]
    pr_cells["in_depmap_sample_info"] = pr_cells["cell"].isin(ds["DepMap_ID"])

    ok_prism_cells = set(pr_cells.loc[(pr_cells["prism_status"] == "ok"), "cell"])
    mapped = cell_attr.dropna(subset=["cell"])
    cells_final = mapped[mapped["cell"].isin(ok_prism_cells)].copy()
    flow["gdsc_cells_mapped_to_depmap"] = len(mapped)
    flow["gdsc_cells_mapped_but_not_in_prism_or_ambiguous_in_prism"] = len(mapped) - len(cells_final)
    flow["prism_cells_ok_without_gdsc_mapping"] = len(ok_prism_cells - set(mapped["cell"]))
    flow["cells_final"] = len(cells_final)
    cells_final = cells_final.merge(ds.drop(columns="COSMIC_ID"), left_on="cell", right_on="DepMap_ID", how="left") \
        .merge(pr_cells[["cell", "prism_ccle_name"]], on="cell", how="left")
    cells_final["name_agrees"] = [alnum(a) == alnum(b) for a, b in
                                  zip(cells_final["gdsc_cell_name"], cells_final["stripped_cell_line_name"])]
    flow["cells_final_name_disagree_audit_only"] = int((~cells_final["name_agrees"]).sum())

    # ================================================================== DRUGS
    # --- GDSC: one DRUG_ID per name within a dataset
    gdrug = {}
    for lab, df in g.items():
        t = df.groupby("drug").agg(ids=("DRUG_ID", lambda s: sorted(set(s))), raw=("DRUG_NAME", "first"))
        t["n"] = t["ids"].map(len)
        gdrug[lab] = t
        flow[f"{lab}_drug_names"] = len(t)
        flow[f"{lab}_drug_names_ambiguous_multiple_drug_ids"] = sorted(t.index[t["n"] > 1])
    # --- PRISM
    pr = pr.copy()
    pr["drug"] = pr["name"].map(fold)
    pr["core"] = pr["broad_id"].str.extract(r"^(BRD-[A-Z]\d+)")[0]
    assert pr["core"].notna().all()
    flow["prism_names"] = pr["drug"].nunique()
    cores_per_name = pr.groupby("drug")["core"].nunique()
    prism_amb_name = set(cores_per_name.index[cores_per_name > 1])
    flow["prism_names_ambiguous_several_compounds"] = sorted(prism_amb_name)
    screen_rows = pr["screen_id"].value_counts().to_dict()
    flow["prism_rows_by_screen_after_str"] = screen_rows
    pr_use = pr[pr["screen_id"].isin(PRISM_SCREENS) & ~pr["drug"].isin(prism_amb_name)]
    flow["prism_rows_dropped_other_screens"] = int((~pr["screen_id"].isin(PRISM_SCREENS)).sum())
    only_other = set(pr["drug"]) - set(pr.loc[pr["screen_id"].isin(PRISM_SCREENS), "drug"])
    flow["prism_names_only_in_other_screens_dropped"] = sorted(only_other)
    # one screen per compound (consistent scale across cells): MTS010 if present, else HTS002
    rank = {s: i for i, s in enumerate(PRISM_SCREENS)}
    pr_use = pr_use.assign(r=pr_use["screen_id"].map(rank))
    pr_use = pr_use[pr_use["r"].eq(pr_use.groupby("core")["r"].transform("min"))]
    nb = pr_use.groupby("core")["broad_id"].nunique()
    prism_amb_batch_cores = set(nb.index[nb > 1])
    flow["prism_names_ambiguous_several_batches_in_chosen_screen"] = sorted(
        pr_use.loc[pr_use["core"].isin(prism_amb_batch_cores), "drug"].unique())
    pr_use = pr_use[~pr_use["core"].isin(prism_amb_batch_cores)]
    assert not pr_use.duplicated(["broad_id", "depmap_id", "screen_id"]).any()
    assert pr_use["drug"].map(pr_use.groupby("drug")["core"].nunique()).eq(1).all()
    prism_drug = pr_use.groupby("drug").agg(broad_id=("broad_id", "first"), screen=("screen_id", "first"),
                                            prism_name=("name", "first"))
    flow["prism_names_usable"] = len(prism_drug)

    # --- GDSC compound table cross-check (identifier consistency + synonym audit)
    comp_name = comp.drop_duplicates("DRUG_ID").set_index("DRUG_ID")["DRUG_NAME"]
    mism = 0
    for lab, df in g.items():
        for did, nm in df.drop_duplicates("DRUG_ID").set_index("DRUG_ID")["DRUG_NAME"].items():
            if did not in comp_name.index or fold(comp_name[did]) != fold(nm):
                mism += 1
    flow["gdsc_drug_id_name_mismatch_vs_compound_table"] = mism
    syn = {}
    for _, r in comp.iterrows():
        for s in str(r["SYNONYMS"]).split(","):
            s = s.strip()
            if s and s.lower() != "nan":
                syn.setdefault(fold(s), set()).add(fold(r["DRUG_NAME"]))
    prism_names_all = set(pr["drug"])
    prism_alnum = {}
    for n in prism_names_all:
        prism_alnum.setdefault(alnum(n), set()).add(n)

    # --- drug audit
    all_names = sorted(set(gdrug["gdsc1"].index) | set(gdrug["gdsc2"].index) | prism_names_all)
    audit = []
    for n in all_names:
        row = {"drug": n}
        reasons = []
        for lab in ("gdsc1", "gdsc2"):
            t = gdrug[lab]
            if n not in t.index:
                row[f"{lab}_drug_id"] = ""
                reasons.append(f"not_in_{lab}")
            elif t.loc[n, "n"] > 1:
                row[f"{lab}_drug_id"] = ";".join(map(str, t.loc[n, "ids"]))
                reasons.append(f"{lab}_ambiguous_multiple_drug_ids")
            else:
                row[f"{lab}_drug_id"] = str(t.loc[n, "ids"][0])
        if n not in prism_names_all:
            reasons.append("not_in_prism")
        elif n in prism_amb_name:
            reasons.append("prism_ambiguous_several_compounds")
        elif n in prism_drug.index:
            row["prism_broad_id"] = prism_drug.loc[n, "broad_id"]
            row["prism_screen"] = prism_drug.loc[n, "screen"]
        elif n in only_other:
            reasons.append("prism_only_in_undocumented_screen")
        else:
            reasons.append("prism_ambiguous_several_batches")
        row["status"] = "drug_ok" if not reasons else ";".join(reasons)
        # reporting-only candidates; never used for matching
        cands = set()
        if n not in prism_names_all:
            cands |= {s for s in syn.keys() if n in syn[s] and s in prism_names_all}
            cands |= prism_alnum.get(alnum(n), set())
        row["prism_candidates_not_used"] = ";".join(sorted(cands))
        audit.append(row)
    audit = pd.DataFrame(audit).fillna("")

    drug_ok = set(audit.loc[audit["status"] == "drug_ok", "drug"])
    flow["drug_names_gdsc1_clean"] = int(sum(gdrug["gdsc1"]["n"] == 1))
    flow["drug_names_gdsc2_clean"] = int(sum(gdrug["gdsc2"]["n"] == 1))
    flow["drug_names_gdsc1_and_gdsc2_clean"] = len(set(gdrug["gdsc1"].index[gdrug["gdsc1"]["n"] == 1])
                                                  & set(gdrug["gdsc2"].index[gdrug["gdsc2"]["n"] == 1]))
    flow["drug_names_in_all_three_before_ambiguity"] = len(
        set(gdrug["gdsc1"].index) & set(gdrug["gdsc2"].index) & prism_names_all)
    flow["drug_names_in_all_three_after_ambiguity"] = len(drug_ok)
    flow["drug_names_with_unused_candidate_matches"] = int((audit["prism_candidates_not_used"] != "").sum())

    # ================================================================== MEASUREMENTS
    cellmap = cells_final.set_index("COSMIC_ID")["cell"]

    def gdsc_vals(lab):
        t = g[lab]
        t = t[t["drug"].isin(drug_ok) & t["COSMIC_ID"].isin(cellmap.index)]
        out = pd.DataFrame({"drug": t["drug"].values, "cell": t["COSMIC_ID"].map(cellmap).values,
                            lab: t["AUC"].values})
        assert not out.duplicated(["drug", "cell"]).any()
        return out
    v1, v2 = gdsc_vals("gdsc1"), gdsc_vals("gdsc2")
    pv = pr_use[pr_use["drug"].isin(drug_ok) & pr_use["depmap_id"].isin(cellmap.values)]
    pv = pd.DataFrame({"drug": pv["drug"].values, "cell": pv["depmap_id"].values, "prism": pv["auc"].values,
                       "prism_r2": pv["r2"].values})
    assert not pv.duplicated(["drug", "cell"]).any()
    flow["pairs_gdsc1"], flow["pairs_gdsc2"], flow["pairs_prism"] = len(v1), len(v2), len(pv)
    m = v1.merge(v2, on=["drug", "cell"]).merge(pv, on=["drug", "cell"])
    flow["pairs_gdsc1_gdsc2"] = len(v1.merge(v2, on=["drug", "cell"]))
    flow["pairs_final_three_way"] = len(m)
    flow["final_prism_pairs_r2_negative_not_filtered"] = int((m["prism_r2"] < 0).sum())
    flow["final_prism_pairs_auc_gt_1_not_filtered"] = int((m["prism"] > 1).sum())
    fit_ok = m.loc[m["prism_r2"].ge(0), ["drug", "cell"]]
    m = m.merge(cells_final[["cell", "tissue"]], on="cell", how="left")
    assert m["tissue"].notna().all()
    m = m[["drug", "cell", "tissue", "gdsc1", "gdsc2", "prism"]].sort_values(["drug", "cell"])
    assert not m.duplicated(["drug", "cell"]).any()
    flow["final_drugs"], flow["final_cells"] = int(m["drug"].nunique()), int(m["cell"].nunique())
    flow["final_pairs_tissue_unknown"] = int((m["tissue"] == "unknown").sum())
    flow["final_cells_per_drug_min_median_max"] = [int(x) for x in
                                                   m.groupby("drug").size().agg(["min", "median", "max"])]
    for c in ("gdsc1", "gdsc2", "prism"):
        flow[f"final_auc_quantiles_{c}_0_5_50_95_100"] = [round(float(x), 4) for x in
                                                         m[c].quantile([0, .05, .5, .95, 1])]
    flow["final_drugs_dropped_no_shared_cells"] = len(drug_ok - set(m["drug"]))

    # ================================================================== OUTPUT
    def save(df, name):
        p = os.path.join(cache, name)
        df.to_csv(p + ".part", index=False)
        os.replace(p + ".part", p)
    save(m, "matched.csv")
    save(m.merge(fit_ok, on=["drug", "cell"], validate="1:1"), "matched-r2.csv")
    fc = m["cell"].unique()
    cw = cells_final[cells_final["cell"].isin(fc)]
    save(cw.rename(columns={"COSMIC_ID": "cosmic_id", "CCLE_Name": "depmap_ccle_name",
                            "stripped_cell_line_name": "depmap_stripped_name"})
         [["cell", "gdsc_cell_name", "cosmic_id", "sanger_model_id", "prism_ccle_name", "depmap_ccle_name",
           "depmap_stripped_name", "tissue", "route", "name_agrees"]].sort_values("cell"),
         "cell_crosswalk.csv")
    fd = set(m["drug"])
    dc = audit[audit["drug"].isin(fd)][["drug", "gdsc1_drug_id", "gdsc2_drug_id", "prism_broad_id", "prism_screen"]]
    dc = dc.merge(prism_drug[["prism_name"]], left_on="drug", right_index=True)
    save(dc[["drug", "gdsc1_drug_id", "gdsc2_drug_id", "prism_broad_id", "prism_name", "prism_screen"]],
         "drug_crosswalk.csv")
    save(audit, "drug_audit.csv")
    ca = cell_attr[["COSMIC_ID", "gdsc_cell_name", "sanger_model_id", "ach_cosmic", "ach_sidm", "cell",
                    "cell_status", "route"]].copy()
    ca["in_final"] = ca["cell"].isin(fc)
    ca["note"] = ["" if (pd.isna(c) or c in ok_prism_cells) else "mapped_but_ambiguous_or_absent_in_prism"
                  for c in ca["cell"]]
    ca.loc[ca["cell"].notna() & ~ca["cell"].isin(pr_cells["cell"]), "note"] = "mapped_but_absent_in_prism"
    save(ca, "cell_audit.csv")
    save(pr_cells.assign(in_final=pr_cells["cell"].isin(fc)), "prism_cell_audit.csv")

    report = {"sources": src, "notes": [
        "AUC: lower = more sensitive in GDSC (area under fitted viability curve) and PRISM (drc curve AUC).",
        "GDSC and PRISM AUCs use different concentration ranges and are not on a common scale; compare ranks.",
        "PRISM AUC can exceed 1 (curve extrapolation); no r2/convergence filter is applied.",
        "tissue = GDSC TCGA_DESC; missing or UNCLASSIFIED -> unknown. It is a TCGA cancer-type code, not anatomical site.",
        "cell = DepMap ID; drug = casefolded whitespace-collapsed GDSC DRUG_NAME.",
        f"PRISM screens used (precedence): {list(PRISM_SCREENS)}; one screen per compound.",
    ], "flow": flow}
    with open(os.path.join(cache, "prepare_report.json"), "w") as f:
        json.dump(report, f, indent=1, default=str)
    log(f"matched.csv: {len(m)} pairs, {flow['final_drugs']} drugs, {flow['final_cells']} cells -> {cache}")


if __name__ == "__main__":
    main()
