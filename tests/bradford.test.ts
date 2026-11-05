import { describe, expect, it, vi } from 'vitest';
import type * as Config from '../src/server/config';
import { computeBradford, parseReplicateRows, validateBradfordData, type BradfordData } from '../src/shared/bradford';
vi.mock('../src/server/config', async (importOriginal) => {
  const actual = await importOriginal<typeof Config>();
  return { ...actual, PATHS: { ...actual.PATHS, db: ':memory:' } };
});
import { createApp } from '../src/server/app';
const app=createApp();
function fixture():BradfordData {
  return {wavelengthNm:595,fit:'linear',subtractBlank:true,standards:[0,125,250,500,1000].map(conc=>({conc,reps:[{abs:0.05+0.001*conc,excluded:false},{abs:0.05+0.001*conc,excluded:false}]})),samples:[{name:'A',dilution:5,cultureId:null,reps:[{abs:0.55,excluded:false},{abs:0.55,excluded:false}]}],notes:''};
}
describe('Bradford calculations',()=>{
  it('fits the blank-corrected linear curve and dilution-adjusted concentration',()=>{
    const r=computeBradford(fixture());
    expect(r.blank).toBeCloseTo(0.05);expect(r.fit!.coef[0]).toBeCloseTo(0,9);expect(r.fit!.coef[1]).toBeCloseTo(0.001,9);expect(r.fit!.r2).toBe(1);
    expect(r.samples[0].wellUgPerMl).toBeCloseTo(500);expect(r.samples[0].stockUgPerUl).toBeCloseTo(2.5);
  });
  it('flags above-range measurements',()=>{const d=fixture();d.samples[0].reps=[{abs:1.2,excluded:false}];expect(computeBradford(d).samples[0].flags).toContain('above_range');});
  it('excludes replicates from CV and concentration',()=>{
    const d=fixture();d.samples[0].reps=[{abs:0.5,excluded:false},{abs:0.9,excluded:false}];
    expect(computeBradford(d).samples[0].flags).toContain('high_cv');d.samples[0].reps[1].excluded=true;
    const r=computeBradford(d);expect(r.samples[0].flags).not.toContain('high_cv');expect(r.samples[0].mean).toBe(0.5);
  });
  it('recovers a quadratic curve and selects the smallest nonnegative root',()=>{
    const d=fixture();d.fit='quadratic';d.subtractBlank=false;
    d.standards=[0,100,250,500,1000].map(conc=>({conc,reps:[{abs:0.1*conc-0.00002*conc**2,excluded:false}]}));d.samples[0].reps=[{abs:45,excluded:false}];
    const r=computeBradford(d);expect(r.fit!.coef[0]).toBeCloseTo(0,9);expect(r.fit!.coef[1]).toBeCloseTo(0.1,9);expect(r.fit!.coef[2]).toBeCloseTo(-0.00002,9);expect(r.samples[0].wellUgPerMl).toBeCloseTo(500);
  });
  it('requires enough standard points',()=>{const d=fixture();d.standards=d.standards.slice(0,2);const r=computeBradford(d);expect(r.fit).toBeNull();expect(r.warnings).toContain('표준점이 부족합니다 (선형 ≥3, 2차 ≥4)');});
  it('parses labels and numeric replicate rows',()=>{expect(parseReplicateRows('A\t0.1\t0.2\n0.3,0.4')).toEqual([{label:'A',values:[0.1,0.2]},{label:'',values:[0.3,0.4]}]);});
  it('validates duplicate concentrations, dilution, and replicate limits',()=>{
    const d=fixture();d.standards[1].conc=0;expect(()=>validateBradfordData(d)).toThrow('표준 농도가 중복됩니다');
    const bad=fixture();bad.samples[0].dilution=0;expect(()=>validateBradfordData(bad)).toThrow();
    const many=fixture();many.samples[0].reps=Array.from({length:7},()=>({abs:0,excluded:false}));expect(()=>validateBradfordData(many)).toThrow();
  });
  it('returns no-data for fully excluded samples and no-root for a negative linear slope',()=>{
    const d=fixture();d.samples[0].reps.forEach(r=>r.excluded=true);expect(computeBradford(d).samples[0].flags).toContain('no_data');
    d.samples[0].reps[0].excluded=false;d.standards.forEach(s=>s.reps.forEach(r=>r.abs=2-0.001*s.conc));expect(computeBradford(d).samples[0].flags).toContain('no_root');
  });
});
describe('Bradford routes',()=>{
  it('creates the BCA preset with nine triplicate standards at 562 nm',async()=>{
    const response=await app.request('/api/bradford',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'BCA 정량',performedAt:'2026-11-05',preset:'bca'})});
    expect(response.status).toBe(201);
    const body=await response.json() as {assay:{id:string};data:BradfordData};
    expect(body.data.wavelengthNm).toBe(562);expect(body.data.standards.map(s=>s.conc)).toEqual([0,25,125,250,500,750,1000,1500,2000]);expect(body.data.standards.every(s=>s.reps.length===3)).toBe(true);
    const update=await app.request(`/api/bradford/${body.assay.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:fixture()})});expect(update.status).toBe(200);
    const list=await (await app.request('/api/bradford')).json() as {id:string;sampleCount:number;r2:number}[];
    expect(list.find(i=>i.id===body.assay.id)).toMatchObject({sampleCount:1,r2:1});
    expect((await app.request(`/api/bradford/${body.assay.id}`,{method:'DELETE'})).status).toBe(200);
    expect((await app.request(`/api/bradford/${body.assay.id}`)).status).toBe(404);
  });
  it('creates ordinary presets with two replicates at 595 nm and rejects invalid data',async()=>{
    for(const preset of ['standard','micro']) {
      const response=await app.request('/api/bradford',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'정량',performedAt:'2026-11-05',preset})});
      const body=await response.json() as {assay:{id:string};data:BradfordData};expect(body.data.wavelengthNm).toBe(595);expect(body.data.standards.every(s=>s.reps.length===2)).toBe(true);
      const data=fixture();data.standards[1].conc=0;
      expect((await app.request(`/api/bradford/${body.assay.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({data})})).status).toBe(400);
    }
  });
});
