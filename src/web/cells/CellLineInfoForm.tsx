import type { CellLineDto } from '../../shared/cell-line';
import { BANK_TO_DATABASE } from '../../shared/catalog';
import { OptionCombobox } from '../components/OptionCombobox';
import { inputCls } from '../components/Dialog';

export type LineForm = Pick<CellLineDto, 'name'|'species'|'tissue'|'disease'|'category'|'sex'|'growthMode'|'sourceBank'|'catalogNo'|'providerUrl'|'providers'|'doublingTime'|'caution'|'biosafety'|'maxPassage'|'tags'|'notes'|'synonyms'|'cellosaurusAc'>;
export const emptyLine: LineForm = { name:'', species:null, tissue:null, disease:null, category:null, sex:null, growthMode:'adherent', sourceBank:null, catalogNo:null, providerUrl:null, providers:[], doublingTime:null, caution:null, biosafety:null, maxPassage:null, tags:[], notes:'', synonyms:[], cellosaurusAc:null };
const textFields = [['name','이름'],['cellosaurusAc','Cellosaurus 등록번호'],['species','종'],['tissue','조직'],['disease','질환'],['category','분류'],['sex','성별'],['catalogNo','카탈로그 번호'],['providerUrl','분양처 URL'],['doublingTime','배가 시간'],['biosafety','생물안전등급']] as const;
export function CellLineInfoForm({value, onChange}: {value: LineForm; onChange(v: LineForm):void}) {
  return <div className="grid gap-4 sm:grid-cols-2">{textFields.map(([key,label]) => <label key={key} className="grid gap-1 text-sm">{label}<input className={inputCls} value={value[key] ?? ''} onChange={e => onChange({...value,[key]:e.target.value})}/></label>)}
    <label className="grid gap-1 text-sm">분양처<OptionCombobox category="bank" value={value.sourceBank ?? ''} onChange={sourceBank => { const provider = value.providers.find(p => p.database === BANK_TO_DATABASE[sourceBank]); onChange({...value,sourceBank,...(provider ? {catalogNo:provider.accession,providerUrl:provider.url} : {})}); }}/></label>
    <fieldset><legend className="text-sm">배양 방식</legend>{([['adherent','부착'],['suspension','부유'],['mixed','혼합']] as const).map(([mode,label]) => <label className="mr-3 text-sm" key={mode}><input type="radio" checked={value.growthMode === mode} onChange={() => onChange({...value,growthMode:mode})}/>{label}</label>)}</fieldset>
    <label className="grid gap-1 text-sm">최대 passage<input type="number" min="0" className={inputCls} value={value.maxPassage ?? ''} onChange={e => onChange({...value,maxPassage:e.target.value === '' ? null : Number(e.target.value)})}/></label>
    <label className="grid gap-1 text-sm">태그 (쉼표로 구분)<input className={inputCls} value={value.tags.join(', ')} onChange={e => onChange({...value,tags:e.target.value.split(',').map(t => t.trim())})}/></label>
    <label className="grid gap-1 text-sm">별칭 (쉼표로 구분)<input className={inputCls} value={value.synonyms.join(', ')} onChange={e => onChange({...value,synonyms:e.target.value.split(',').map(t => t.trim())})}/></label>
    <label className="grid gap-1 text-sm sm:col-span-2">주의 사항<textarea className={inputCls} value={value.caution ?? ''} onChange={e => onChange({...value,caution:e.target.value})}/></label>
    {value.caution && <div role="alert" className="rounded-lg bg-danger-soft p-3 text-danger sm:col-span-2">{value.caution}</div>}
    <label className="grid gap-1 text-sm sm:col-span-2">메모<textarea className={inputCls} value={value.notes} onChange={e => onChange({...value,notes:e.target.value})}/></label>
  </div>;
}
