export interface Rep { abs: number | null; excluded: boolean }
export interface BradfordData {
  wavelengthNm: number; fit: 'linear' | 'quadratic'; subtractBlank: boolean;
  standards: { conc: number; reps: Rep[] }[];
  samples: { name: string; dilution: number; cultureId: string | null; reps: Rep[] }[];
  notes: string;
}
export const STANDARD_PRESETS: { id: 'standard' | 'micro' | 'bca'; label: string; concs: number[] }[] = [
  { id: 'standard', label: '표준 (0–2000 µg/mL)', concs: [0,125,250,500,750,1000,1500,2000] },
  { id: 'micro', label: '마이크로 (0–25 µg/mL)', concs: [0,1,2.5,5,10,15,20,25] },
  { id: 'bca', label: 'BCA (0–2000 µg/mL, 562 nm)', concs: [0,25,125,250,500,750,1000,1500,2000] },
];
export type SampleFlag = 'above_range' | 'below_range' | 'high_cv' | 'no_root' | 'no_data';
export interface BradfordResult {
  fit: { kind: 'linear' | 'quadratic'; coef: number[]; r2: number; n: number } | null; blank: number | null;
  standards: { conc: number; mean: number | null; sd: number | null; cv: number | null; corrected: number | null }[];
  samples: { name: string; mean: number | null; cv: number | null; corrected: number | null; wellUgPerMl: number | null; stockUgPerMl: number | null; stockUgPerUl: number | null; flags: SampleFlag[] }[];
  warnings: string[];
}
function stats(reps: Rep[]) {
  const values = reps.filter(r => !r.excluded && r.abs !== null).map(r => r.abs!);
  if (!values.length) return { mean: null, sd: null, cv: null, n: 0 };
  const mean = values.reduce((a,b) => a+b,0)/values.length;
  const sd = values.length < 2 ? null : Math.sqrt(values.reduce((sum,v) => sum+(v-mean)**2,0)/(values.length-1));
  return { mean, sd, cv: sd === null || mean === 0 ? null : Math.abs(sd/mean)*100, n: values.length };
}
function fitCoefficients(points: { x: number; y: number }[], degree: number): number[] | null {
  // Scale x before solving to keep the quadratic normal equations well conditioned.
  const scale = Math.max(...points.map(p => Math.abs(p.x)), 1);
  const size = degree+1;
  const matrix = Array.from({length:size},(_,i) => Array.from({length:size+1},(_,j) => points.reduce((s,p) => s+(j===size ? p.y*(p.x/scale)**i : (p.x/scale)**(i+j)),0)));
  for (let col=0; col<size; col++) {
    let pivot=col;
    for (let row=col+1; row<size; row++) if (Math.abs(matrix[row][col])>Math.abs(matrix[pivot][col])) pivot=row;
    [matrix[col],matrix[pivot]]=[matrix[pivot],matrix[col]];
    if (Math.abs(matrix[col][col])<1e-12) return null;
    const divisor=matrix[col][col];
    for (let j=col;j<=size;j++) matrix[col][j]/=divisor;
    for (let row=0;row<size;row++) if(row!==col) {
      const factor=matrix[row][col];
      for(let j=col;j<=size;j++) matrix[row][j]-=factor*matrix[col][j];
    }
  }
  return matrix.map((row,i) => row[size]/scale**i);
}
/**
 * Bradford/BCA 공통 표준곡선 계산. 흡광도는 포함된 반복값만 평균하며,
 * well 농도(µg/mL)에 희석배수를 적용한 뒤 1000으로 나눠 원액 µg/µL를 구한다.
 * BCA 프리셋 생성 시에는 라우트에서 562 nm·3회 반복을 적용한다.
 */
export function computeBradford(d: BradfordData): BradfordResult {
  const raw = d.standards.map(s => ({conc:s.conc,...stats(s.reps)}));
  const blank = d.subtractBlank ? raw.find(s => s.conc===0)?.mean ?? null : null;
  const standards = raw.map(({n: _n,...s}) => ({...s, corrected:s.mean===null ? null : s.mean-(blank??0)}));
  const points = standards.filter(s => s.corrected!==null).map(s => ({x:s.conc,y:s.corrected!}));
  const warnings: string[]=[];
  let fit: BradfordResult['fit']=null;
  if(points.length < (d.fit==='linear'?3:4)) warnings.push('표준점이 부족합니다 (선형 ≥3, 2차 ≥4)');
  else {
    const coef=fitCoefficients(points,d.fit==='linear'?1:2);
    if(coef) {
      const average=points.reduce((sum,p)=>sum+p.y,0)/points.length;
      const residual=points.reduce((sum,p)=>sum+(p.y-coef.reduce((s,c,i)=>s+c*p.x**i,0))**2,0);
      const total=points.reduce((sum,p)=>sum+(p.y-average)**2,0);
      const r2=total===0 ? (residual<1e-20?1:0) : 1-residual/total;
      fit={kind:d.fit,coef,r2,n:points.length};
      if(r2<0.98) warnings.push('R²가 0.98 미만입니다');
    } else warnings.push('표준곡선을 계산할 수 없습니다');
  }
  const maxConc=Math.max(...points.map(p=>p.x),0);
  const maxY=Math.max(...points.map(p=>p.y));
  const minPositiveY=Math.min(...points.filter(p=>p.x>0).map(p=>p.y));
  const samples=d.samples.map(sample => {
    const s=stats(sample.reps);
    const corrected=s.mean===null ? null : s.mean-(blank??0);
    const flags: SampleFlag[]=[];
    let wellUgPerMl: number|null=null;
    if(corrected===null) flags.push('no_data');
    else {
      if(points.length && corrected>maxY) flags.push('above_range');
      if(Number.isFinite(minPositiveY) && corrected<minPositiveY) flags.push('below_range');
      if(s.n>=2 && s.cv!==null && s.cv>10) flags.push('high_cv');
      if(fit) {
        const [a,b,c]=fit.coef;
        if(fit.kind==='linear' || Math.abs(c)<1e-15) {
          if(b>0) wellUgPerMl=(corrected-a)/b;
        } else {
          const discriminant=b*b-4*c*(a-corrected);
          if(discriminant>=0) {
            const roots=[(-b-Math.sqrt(discriminant))/(2*c),(-b+Math.sqrt(discriminant))/(2*c)].filter(x=>x>=0 && x<=maxConc*1.5);
            if(roots.length) wellUgPerMl=Math.min(...roots);
          }
        }
        if(wellUgPerMl===null || !Number.isFinite(wellUgPerMl)) {wellUgPerMl=null;flags.push('no_root');}
      }
    }
    const stockUgPerMl=wellUgPerMl===null?null:wellUgPerMl*sample.dilution;
    return {name:sample.name,mean:s.mean,cv:s.cv,corrected,wellUgPerMl,stockUgPerMl,stockUgPerUl:stockUgPerMl===null?null:stockUgPerMl/1000,flags};
  });
  return {fit,blank,standards,samples,warnings};
}
export function parseReplicateRows(text: string): { label: string; values: number[] }[] {
  return text.split(/\r?\n/).filter(line=>line.trim()).map(line=>{
    const tokens=line.trim().split(/[\t,\s]+/);
    const label=Number.isFinite(Number(tokens[0]))?'':tokens.shift()!;
    const values=tokens.map(Number);
    if(values.some(v=>!Number.isFinite(v))) throw new Error('흡광도는 숫자로 입력하세요');
    return {label,values};
  });
}
export function validateBradfordData(raw: unknown): BradfordData {
  if(!raw || typeof raw!=='object' || Array.isArray(raw)) throw new Error('정량 데이터 형식이 올바르지 않습니다');
  const d=raw as Record<string,unknown>;
  const number=(v:unknown,min:number,inclusive=true):number=>{if(typeof v!=='number'||!Number.isFinite(v)||(inclusive?v<min:v<=min)) throw new Error('정량 수치가 올바르지 않습니다');return v;};
  const reps=(v:unknown):Rep[]=>{
    if(!Array.isArray(v)||v.length<1||v.length>6) throw new Error('반복 측정은 1–6개여야 합니다');
    return v.map(r=>{if(!r||typeof r!=='object'||typeof r.excluded!=='boolean') throw new Error('반복 측정 형식이 올바르지 않습니다');return {abs:r.abs===null?null:number(r.abs,-Infinity),excluded:r.excluded};});
  };
  if(!Array.isArray(d.standards)||d.standards.length<1||d.standards.length>24) throw new Error('표준은 1–24개여야 합니다');
  const standards=d.standards.map(s=>{if(!s||typeof s!=='object') throw new Error('표준 형식이 올바르지 않습니다');return {conc:number(s.conc,0),reps:reps(s.reps)};});
  if(new Set(standards.map(s=>s.conc)).size!==standards.length) throw new Error('표준 농도가 중복됩니다');
  if(!Array.isArray(d.samples)||d.samples.length>96) throw new Error('시료는 최대 96개입니다');
  const samples=d.samples.map(s=>{
    if(!s||typeof s!=='object'||typeof s.name!=='string'||s.name.length>200||(s.cultureId!==null&&typeof s.cultureId!=='string')) throw new Error('시료 형식이 올바르지 않습니다');
    return {name:s.name,dilution:s.dilution===undefined?1:number(s.dilution,0,false),cultureId:s.cultureId,reps:reps(s.reps)};
  });
  if(d.fit!=='linear'&&d.fit!=='quadratic') throw new Error('적합 방식을 선택하세요');
  if(typeof d.subtractBlank!=='boolean'||typeof d.notes!=='string'||d.notes.length>50000) throw new Error('정량 설정이 올바르지 않습니다');
  return {wavelengthNm:number(d.wavelengthNm,0,false),fit:d.fit,subtractBlank:d.subtractBlank,standards,samples,notes:d.notes};
}
