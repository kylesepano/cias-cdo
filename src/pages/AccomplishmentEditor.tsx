import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { Download,Plus,Save,Trash2 } from 'lucide-react'
import { useEffect,useState } from 'react'
import { draftSchema,emptyActivity,emptyTask,startingDraft,type AccomplishmentDraft,type Annex,type ApprovedTask,type ReportPeriod,type SavedAccomplishment } from '../accomplishments'
import { db,rpc,unwrap,type Profile } from '../data'
import { Busy,Button,Card,ErrorText,Field } from '../ui/controls'

export default function AccomplishmentEditor({user,period,onDirty}:{user:Profile;period:ReportPeriod;onDirty:(dirty:boolean)=>void}) {
  const saved=useQuery({queryKey:['accomplishment-report',user.id,period],queryFn:()=>unwrap<SavedAccomplishment|null>(
    db.from('accomplishment_report_drafts').select('period_start,period_end,revision,updated_at,content')
      .eq('owner_id',user.id).eq('period_start',period.from_date).eq('period_end',period.to_date).maybeSingle(),
  )})
  const source=useQuery({queryKey:['accomplishment-source',user.id,period],enabled:saved.isSuccess && !saved.data,
    queryFn:()=>rpc<ApprovedTask[]>('accomplishment_draft',{staff_id:user.id,...period}),
  })
  if (saved.isPending || (saved.isSuccess && !saved.data && source.isPending)) return <Card title="My accomplishment draft"><Busy/></Card>
  if (saved.error || source.error && !saved.data) return <Card title="My accomplishment draft"><ErrorText issue={saved.error || source.error}/></Card>
  const initial=saved.data ? draftSchema.safeParse(saved.data.content) : null
  if (initial && !initial.success) return <Card title="My accomplishment draft">
    <p className="error" role="alert">This saved draft could not be opened.</p>
  </Card>
  return <Editor user={user} period={period} onDirty={onDirty} revision={saved.data?.revision || 0}
    initial={initial?.data || startingDraft(user,source.data || [])}/>
}

function Editor({user,period,onDirty,revision,initial}:{
  user:Profile;period:ReportPeriod;onDirty:(dirty:boolean)=>void;revision:number;initial:AccomplishmentDraft
}) {
  const [content,setContent]=useState(initial)
  const [savedContent,setSavedContent]=useState(initial)
  const [savedRevision,setSavedRevision]=useState(revision)
  const [annex,setAnnex]=useState<Annex>('A')
  const dirty=content!==savedContent
  const cache=useQueryClient()

  useEffect(()=>{
    onDirty(dirty)
    if (!dirty) return
    const leave=(event:BeforeUnloadEvent)=>event.preventDefault()
    window.addEventListener('beforeunload',leave)
    return ()=>{onDirty(false);window.removeEventListener('beforeunload',leave)}
  },[dirty,onDirty])

  const save=useMutation({
    mutationFn:(draft:AccomplishmentDraft)=>rpc<SavedAccomplishment>('save_accomplishment_report',{
      ...period,draft:draftSchema.parse(draft),expected_revision:savedRevision,
    }),
    onSuccess:(record,submitted)=>{
      setSavedContent(submitted)
      setSavedRevision(record.revision)
      cache.setQueryData(['accomplishment-report',user.id,period],record)
      void cache.invalidateQueries({queryKey:['accomplishment-periods',user.id]})
    },
  })
  const download=useMutation({mutationFn:async (target:Annex)=>{
    const {downloadAccomplishment}=await import('../accomplishment-word')
    await downloadAccomplishment(target,draftSchema.parse(content),period)
  }})
  const set=<K extends keyof AccomplishmentDraft,>(key:K,value:AccomplishmentDraft[K])=>setContent(current=>({...current,[key]:value}))
  const short=(key:'employee'|'position'|'division'|'preparedOn'|'reviewer'|'reviewerPosition'|'completed'|'ongoing',label:string,type='text')=>
    <Field label={label}><input type={type} maxLength={160} value={content[key]} onChange={event=>set(key,event.target.value)}/></Field>
  const long=(key:'summary'|'issues'|'plans',label:string)=>
    <Field label={label} wide><textarea maxLength={6000} rows={3} value={content[key]} onChange={event=>set(key,event.target.value)}/></Field>

  return <Card title="My accomplishment draft" description="Edit the report for this period and download either annex as a Word file.">
    <div className="stack">
      <div className="report-draft-toolbar">
        <div className="segmented" role="group" aria-label="Word annex">
          <button type="button" aria-pressed={annex==='A'} onClick={()=>setAnnex('A')}>Annex A · Monthly report</button>
          <button type="button" aria-pressed={annex==='B'} onClick={()=>setAnnex('B')}>Annex B · Detailed activity</button>
        </div>
        <div className="actions">
          <Button onClick={()=>download.mutate(annex)} disabled={download.isPending}><Download size={16}/> Download Word</Button>
          <Button variant="primary" onClick={()=>save.mutate(content)} disabled={save.isPending || !!savedRevision && !dirty}>
            <Save size={16}/> {save.isPending ? 'Saving…' : 'Save draft'}
          </Button>
        </div>
      </div>
      <p className="muted" role="status">{dirty ? 'Unsaved changes' : savedRevision ? 'Draft saved' : 'New draft'}</p>
      <ErrorText issue={save.error || download.error}/>
      <div className="form-grid">
        {short('employee','Employee name')}
        {short('position','Position')}
        {annex==='A' && short('division','Division or section')}
        {short('preparedOn','Date prepared','date')}
        {annex==='A' && <>{short('reviewer','Reviewer name')}{short('reviewerPosition','Reviewer position')}</>}
      </div>
      {annex==='A' ? <>
        <section className="stack" aria-labelledby="draft-tasks">
          <div className="report-draft-toolbar">
            <h3 id="draft-tasks">I. Key tasks and responsibilities</h3>
            <Button size="small" onClick={()=>set('tasks',[...content.tasks,emptyTask()])} disabled={content.tasks.length>=150}><Plus size={15}/> Add task</Button>
          </div>
          {!content.tasks.length && <p className="muted">Add a task or responsibility to report.</p>}
          {content.tasks.map((row,index)=><fieldset className="form-grid draft-row" key={index}>
            <legend>Task {index+1}</legend>
            <Field label="Task or responsibility" wide><textarea rows={2} maxLength={6000} value={row.task}
              onChange={event=>set('tasks',content.tasks.map((item,i)=>i===index ? {...item,task:event.target.value} : item))}/></Field>
            <Field label="Target output"><input maxLength={160} value={row.target}
              onChange={event=>set('tasks',content.tasks.map((item,i)=>i===index ? {...item,target:event.target.value} : item))}/></Field>
            <Field label="Actual accomplishment"><input maxLength={160} value={row.actual}
              onChange={event=>set('tasks',content.tasks.map((item,i)=>i===index ? {...item,actual:event.target.value} : item))}/></Field>
            <Field label="Remarks" wide><textarea rows={2} maxLength={6000} value={row.remarks}
              onChange={event=>set('tasks',content.tasks.map((item,i)=>i===index ? {...item,remarks:event.target.value} : item))}/></Field>
            <Button size="small" className="draft-remove" aria-label={'Remove task '+(index+1)}
              onClick={()=>set('tasks',content.tasks.filter((_,i)=>i!==index))}><Trash2 size={14}/> Remove task</Button>
          </fieldset>)}
        </section>
        <section className="form-grid" aria-labelledby="draft-summary">
          <h3 id="draft-summary" className="wide">II. Summary of outputs and results</h3>
          {short('completed','Total task groups accomplished')}
          {short('ongoing','Total tasks ongoing')}
          {long('summary','Summary')}
          <h3 className="wide">III. Issues and challenges encountered</h3>
          {long('issues','Issues and challenges')}
          <h3 className="wide">IV. Recommendations and action plans for the next month</h3>
          {long('plans','Recommendations and action plans')}
        </section>
      </> : <section className="stack" aria-labelledby="draft-activities">
        <div className="report-draft-toolbar">
          <h3 id="draft-activities">Detailed activities</h3>
          <Button size="small" onClick={()=>set('activities',[...content.activities,emptyActivity()])} disabled={content.activities.length>=365}><Plus size={15}/> Add activity</Button>
        </div>
        <p className="muted">Approved tasks use the reported completion date. You can adjust the date in this draft.</p>
        {content.activities.map((row,index)=><fieldset className="form-grid draft-row draft-activity" key={index}>
          <legend>Activity {index+1}</legend>
          <Field label="Activity date"><input type="date" value={row.date}
            onChange={event=>set('activities',content.activities.map((item,i)=>i===index ? {...item,date:event.target.value} : item))}/></Field>
          <Field label="Activity"><textarea rows={2} maxLength={6000} value={row.activity}
            onChange={event=>set('activities',content.activities.map((item,i)=>i===index ? {...item,activity:event.target.value} : item))}/></Field>
          <Button size="small" className="draft-remove" aria-label={'Remove activity '+(index+1)}
            onClick={()=>set('activities',content.activities.filter((_,i)=>i!==index))}><Trash2 size={14}/> Remove activity</Button>
        </fieldset>)}
      </section>}
    </div>
  </Card>
}
