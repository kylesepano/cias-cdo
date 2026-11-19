import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CalendarDays, ChevronRight, ClipboardList, FolderOpen, GitBranch, LayoutGrid, List, Plus, Search, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { Link,useParams,useSearchParams } from 'react-router-dom'
import { can,db,now,pretty,rpc,statusNames,unwrap,useAction,useDirectory,useRows,values,type Engagement,type Person,type Profile,type Task } from '../data'
import { Avatar,Busy,Button,Card,Dialog,Empty,ErrorText,Field,PageTitle,StaffPicker,Status } from '../ui/controls'

const statuses=['todo','in_progress','submitted','needs_revision','completed']
const workKeys=['tasks','task_activity','task_assignees','task_comments','audit_engagements','notifications','accomplishment-source','reports']
const useWorkspaces=()=>useQuery({queryKey:['audit_engagements'],queryFn:()=>unwrap<Engagement[]>(db.from('audit_engagements').select('*').order('title'))})
const useMembers=(id?:string)=>useQuery({queryKey:['audit_engagement_members',id],enabled:!!id,
  queryFn:()=>unwrap<{user_id:string}[]>(db.from('audit_engagement_members').select('user_id').eq('engagement_id',id!))})
export function Tasks({user}:{user:Profile}) {
  const [searchParams,setParams]=useSearchParams()
  const [search,setSearch]=useState(''), [status,setStatus]=useState(''), [view,setView]=useState('list'), [scope,setScope]=useState('')
  const [add,setAdd]=useState(false)
  const tasks=useRows<Task>('tasks'), workspaces=useWorkspaces()
  const selected=searchParams.get('task')
  const visible=(tasks.data || []).filter(task=>(!status || task.status===status) &&
    (!scope || (scope==='standalone' ? task.engagement_id===null : task.engagement_id===scope)) &&
    task.title.toLowerCase().includes(search.toLowerCase()))
  const open = (id:string) => setParams({task:id})
  return <><PageTitle title="My tasks" description="Manage assignments, submit work, and track reviews.">
    {can(user,'task:create') && <Button variant="primary" onClick={()=>setAdd(true)}><Plus size={17}/> New task</Button>}
  </PageTitle>
  <div className="work-filters">
    <label className="search"><Search size={16}/><input aria-label="Search tasks" placeholder="Search tasks" value={search} onChange={e=>setSearch(e.target.value)}/></label>
    <select aria-label="Task status" value={status} onChange={e=>setStatus(e.target.value)}><option value="">All statuses</option>{statuses.map(item=><option value={item} key={item}>{statusNames[item]}</option>)}</select>
    <select aria-label="Task engagement" value={scope} onChange={e=>setScope(e.target.value)}><option value="">All engagements</option><option value="standalone">Standalone</option>{workspaces.data?.map(item=><option value={item.id} key={item.id}>{item.title}</option>)}</select>
    <div className="segmented"><button aria-pressed={view==='list'} onClick={()=>setView('list')}><List size={16}/> List</button><button aria-pressed={view==='board'} onClick={()=>setView('board')}><LayoutGrid size={16}/> Board</button></div>
  </div>
  <ErrorText issue={tasks.error || workspaces.error}/>
  {tasks.isPending ? <Busy/> : !visible.length ? <Card><Empty title="No tasks to display" detail="New assignments and tasks you review appear here."/></Card> :
    view==='board' ? <div className="kanban">{statuses.filter(item=>!status || status===item).map(item=><section className="kanban-column" key={item}>
      <h2>{statusNames[item]} <span>{visible.filter(task=>task.status===item).length}</span></h2>
      {visible.filter(task=>task.status===item).map(task=><TaskRow key={task.id} task={task} open={open}/>)}
    </section>)}</div> : <div className="stack">
    {[null,...(workspaces.data || [])].map(engagement=>{
      const group=visible.filter(task=>task.engagement_id===(engagement?.id || null))
      return group.length ? <Card key={engagement?.id || 'standalone'} title={engagement?.title || 'Standalone tasks'}><div className="record-list">
        {group.map(task=><TaskRow key={task.id} task={task} open={open}/>)}</div></Card> : null
    })}</div>}
  {add && <TaskEditor user={user} close={()=>setAdd(false)}/>}
  {selected && <TaskDetails user={user} id={selected} close={()=>setParams({})}/>}</>
}
function TaskRow({task,open,depth=0}:{task:Task;open:(id:string)=>void;depth?:number}) {
  const overdue=task.status!=='completed' && task.due_on && task.due_on<now().toISODate()!
  return <button className="record-row task-row" type="button" onClick={()=>open(task.id)} style={{paddingInlineStart:16+Math.min(depth,6)*18}}>
    <span className="stat-icon mint">{task.parent_id ? <GitBranch size={15}/> : <ClipboardList size={16}/>}</span>
    <div><strong>{task.title}</strong><small>{task.due_on ? 'Due '+pretty(task.due_on) : 'No due date'} · {task.priority} priority</small></div>
    {overdue && <span className="badge declined">Overdue</span>}<Status status={task.status}/><ChevronRight size={16}/>
  </button>
}
export function Engagements({user}:{user:Profile}) {
  const list=useWorkspaces(), people=useDirectory()
  const [add,setAdd]=useState(false), [search,setSearch]=useState('')
  const filtered=(list.data || []).filter(item=>(item.title+' '+item.code+' '+item.audited_office).toLowerCase().includes(search.toLowerCase()))
  return <><PageTitle title="Audit engagements" description="Workspaces shared with assigned audit team members.">
    {can(user,'engagement:create') && <Button variant="primary" onClick={()=>setAdd(true)}><Plus size={17}/> New engagement</Button>}
  </PageTitle><div className="work-filters"><label className="search"><Search size={16}/><input aria-label="Search engagements" placeholder="Search engagements" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
  <ErrorText issue={list.error || people.error}/>{list.isPending ? <Busy/> : filtered.length ? <div className="engagement-grid">{filtered.map(item=>
    <Card key={item.id} className="engagement-card"><span className="stat-icon mint"><FolderOpen size={19}/></span><span className="badge">{item.code}</span>
      <h2><Link to={'/engagements/'+item.id}>{item.title}</Link></h2><p>{item.audited_office}</p>
      <div className="engagement-footer"><span>{people.data?.find(person=>person.id===item.lead_id)?.full_name || 'Audit lead'}</span>
        <Link className="text-link" to={'/engagements/'+item.id}>Open workspace <ChevronRight size={15}/></Link></div>
    </Card>)}</div> : <Card><Empty title="No engagements to display" detail="Engagements appear here when you are added to the audit team."/></Card>}
  {add && <EngagementEditor personList={people.data || []} close={()=>setAdd(false)}/>}</>
}
export function Workspace({user}:{user:Profile}) {
  const {id}=useParams()
  const details=useQuery({queryKey:['audit_engagements',id],queryFn:()=>unwrap<Engagement|null>(db.from('audit_engagements').select('*').eq('id',id!).maybeSingle())})
  const tasks=useQuery({queryKey:['tasks','engagement',id],queryFn:()=>unwrap<Task[]>(db.from('tasks').select('*').eq('engagement_id',id!).order('created_at'))})
  const audit=useQuery({queryKey:['task_activity','engagement',id],enabled:!!tasks.data?.length,queryFn:()=>unwrap<Activity[]>(db.from('task_activity').select('*').in('task_id',tasks.data!.map(t=>t.id)).order('id',{ascending:false}).limit(20))})
  const staff=useDirectory(), members=useMembers(id)
  const [adding,setAdding]=useState(false), [memberEdit,setMemberEdit]=useState(false), [active,setActive]=useState('')
  const row=details.data
  if (details.isPending) return <Busy/>
  if (!row) return <><PageTitle title="Engagement unavailable"><Button asChild><Link to="/engagements"><ArrowLeft size={16}/> All engagements</Link></Button></PageTitle>
    <Card><ErrorText issue={details.error}/><Empty title="This workspace is unavailable"/></Card></>
  const work=tasks.data || []
  const staffInSpace=(staff.data || []).filter(person=>members.data?.some(m=>m.user_id===person.id))
  const completed=work.filter(task=>task.status==='completed').length
  const progress=work.length ? Math.round(100*completed/work.length) : 0
  const renderTasks=(parent:string|null,depth:number):React.ReactNode=>work.filter(task=>parent ? task.parent_id===parent : !task.parent_id || !work.some(item=>item.id===task.parent_id))
    .map(task=><div key={task.id}><TaskRow task={task} open={setActive} depth={depth}/>{renderTasks(task.id,depth+1)}</div>)
  return <><Link className="text-link back-link" to="/engagements"><ArrowLeft size={16}/> Audit engagements</Link>
    <PageTitle title={row.title} description={row.code+' · '+row.audited_office}>{can(user,'task:create') && <Button variant="primary" onClick={()=>setAdding(true)}><Plus size={17}/> New task</Button>}</PageTitle>
    <ErrorText issue={tasks.error || staff.error || members.error || audit.error}/>
    <div className="dashboard-grid"><Card title="Summary">
      {row.description && <p className="article-body preserve">{row.description}</p>}
      <p className="inline muted"><CalendarDays size={17}/> {pretty(row.planned_start)} – {pretty(row.planned_end)}</p>
      <div className="progress-info"><span>Visible task progress</span><strong>{progress}%</strong></div><progress max={100} value={progress} aria-label="Visible task progress"/>
      <p className="muted">{completed} of {work.length} tasks completed</p>
    </Card><Card title="Engagement team" action={can(user,'engagement:create') && [row.creator_id,row.lead_id].includes(user.id) ? <Button size="small" onClick={()=>setMemberEdit(true)}><UsersRound size={16}/> Edit team</Button> : undefined}>
      <div className="record-list">{staffInSpace.map(person=><div className="record-row" key={person.id}><Avatar name={person.full_name}/><div><strong>{person.full_name}</strong><small>{person.id===row.lead_id ? 'Engagement lead' : person.designation}</small></div></div>)}</div>
    </Card><Card className="full-span" title="Tasks and subtasks">
      {tasks.isPending ? <Busy/> : work.length ? <div className="record-list">{renderTasks(null,0)}</div> : <Empty title="No visible tasks for this engagement"/>}
    </Card><Card className="full-span" title="Workspace activity">
      {audit.data?.length ? <div className="record-list">{audit.data.map(line=><div className="record-row" key={line.id}><ClipboardList size={17}/>
        <div><strong>{work.find(task=>task.id===line.task_id)?.title} · {statusNames[line.status]}</strong><small>{staff.data?.find(person=>person.id===line.actor_id)?.full_name || 'Former employee'} · {pretty(line.created_at)}</small></div></div>)}</div> : <Empty title="No workspace activity yet"/>}
    </Card></div>
    {adding && <TaskEditor user={user} defaultEngagement={row.id} close={()=>setAdding(false)}/>}
    {active && <TaskDetails id={active} user={user} close={()=>setActive('')}/>}
    {memberEdit && <MemberEditor id={row.id} people={staff.data || []} initial={staffInSpace.map(p=>p.id)} close={()=>setMemberEdit(false)}/>}
  </>
}
function MemberEditor({id,people,initial,close}:{id:string;people:Person[];initial:string[];close:()=>void}) {
  const [selected,setSelected]=useState(initial)
  const save=useAction(()=>rpc('set_engagement_members',{target:id,members:selected}),['audit_engagement_members','tasks'],close)
  return <Dialog title="Edit engagement team" close={close}><div className="stack">
    <StaffPicker label="Engagement members" people={people} selected={selected} setSelected={setSelected}/>
    <ErrorText issue={save.error}/><div className="dialog-actions"><Button variant="primary" disabled={save.isPending} onClick={()=>save.mutate()}>Save team</Button></div>
  </div></Dialog>
}
function EngagementEditor({personList,close}:{personList:Person[];close:()=>void}) {
  const [members,setMembers]=useState<string[]>([])
  const add=useAction((input:Record<string,string>)=>rpc('create_engagement',{data:{...input,planned_start:input.planned_start || null,planned_end:input.planned_end || null},members}),
    ['audit_engagements','audit_engagement_members'],close)
  return <Dialog title="New audit engagement" close={close}><form className="form-grid" onSubmit={e=>{e.preventDefault();add.mutate(values(e.currentTarget))}}>
    <Field label="Engagement title" wide><input name="title" maxLength={160} required/></Field>
    <Field label="Audited office"><input name="audited_office" maxLength={120} required/></Field><Field label="Reference code"><input name="code" maxLength={40} required placeholder="e.g. HR-2026-01"/></Field>
    <Field label="Lead auditor" wide><select name="lead_id" required defaultValue=""><option value="" disabled>Choose the lead</option>{personList.map(person=><option key={person.id} value={person.id}>{person.full_name}</option>)}</select></Field>
    <Field label="Planned start"><input name="planned_start" type="date"/></Field><Field label="Planned end"><input name="planned_end" type="date"/></Field>
    <Field label="Description" wide><textarea name="description" rows={3}/></Field>
    <StaffPicker label="Engagement members" people={personList} selected={members} setSelected={setMembers}/>
    <ErrorText issue={add.error}/><div className="dialog-actions wide"><Button variant="primary" type="submit" disabled={add.isPending}>Create engagement</Button></div>
  </form></Dialog>
}
function TaskEditor({user,defaultEngagement,close}:{user:Profile;defaultEngagement?:string;close:()=>void}) {
  const [engagement,setEngagement]=useState(defaultEngagement || '')
  const [assignees,setAssignees]=useState<string[]>([])
  const people=useDirectory(), workspaces=useWorkspaces(), members=useMembers(engagement)
  const parents=useRows<Task>('tasks')
  const peopleInSpace=(people.data || []).filter(person=>!engagement || members.data?.some(member=>member.user_id===person.id))
  const create=useAction((input:Record<string,string>)=>rpc('create_task',{data:{...input,engagement_id:engagement || null,parent_id:input.parent_id || null,
    starts_on:input.starts_on || null,due_on:input.due_on || null},assignees}),workKeys,close)
  return <Dialog title="New task" close={close}><form className="form-grid" onSubmit={e=>{e.preventDefault();create.mutate(values(e.currentTarget))}}>
    <Field label="Task title" wide><input name="title" maxLength={160} required/></Field>
    <Field label="Engagement"><select value={engagement} onChange={e=>{setEngagement(e.target.value);setAssignees([])}}>
      <option value="">Standalone task</option>{workspaces.data?.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
    <Field label="Parent task"><select name="parent_id" key={engagement} defaultValue=""><option value="">None</option>
      {parents.data?.filter(item=>item.engagement_id===(engagement || null)).map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></Field>
    <Field label="Start date"><input name="starts_on" type="date"/></Field><Field label="Due date"><input name="due_on" type="date"/></Field>
    <Field label="Priority"><select name="priority" defaultValue="normal">{['low','normal','high','urgent'].map(item=><option key={item}>{item}</option>)}</select></Field>
    <Field label="Independent reviewer"><select name="reviewer_id" key={engagement} required defaultValue={can(user,'task:review') ? user.id : ''}>
      <option value="" disabled>Choose a reviewer</option>{peopleInSpace.map(person=><option key={person.id} value={person.id}>{person.full_name}</option>)}</select></Field>
    <Field label="Description" wide><textarea name="description" rows={3}/></Field>
    <StaffPicker label="Assignees" people={peopleInSpace} selected={assignees} setSelected={setAssignees}/>
    <ErrorText issue={create.error || people.error || workspaces.error || members.error || parents.error}/>
    <div className="dialog-actions wide"><Button type="submit" variant="primary" disabled={create.isPending || !assignees.length}>Assign task</Button></div>
  </form></Dialog>
}
type Activity={id:number;task_id:string;actor_id:string;status:string;note:string|null;created_at:string}
function TaskDetails({user,id,close}:{user:Profile;id:string;close:()=>void}) {
  const query=useQuery({queryKey:['tasks','detail',id],queryFn:()=>unwrap<Task|null>(db.from('tasks').select('*').eq('id',id).maybeSingle())})
  const people=useDirectory(), names=(person?:string|null)=>people.data?.find(row=>row.id===person)?.full_name || 'Former employee'
  const children=useQuery({queryKey:['tasks','children',id],queryFn:()=>unwrap<Task[]>(db.from('tasks').select('*').eq('parent_id',id).order('created_at'))})
  const assignees=useQuery({queryKey:['task_assignees',id],queryFn:()=>unwrap<{user_id:string}[]>(db.from('task_assignees').select('user_id').eq('task_id',id))})
  const comments=useQuery({queryKey:['task_comments',id],queryFn:()=>unwrap<{id:string;author_id:string;body:string;created_at:string}[]>(db.from('task_comments').select('*').eq('task_id',id).order('created_at').limit(500))})
  const history=useQuery({queryKey:['task_activity',id],queryFn:()=>unwrap<Activity[]>(db.from('task_activity').select('*').eq('task_id',id).order('id',{ascending:false}))})
  const [body,setBody]=useState(''), [note,setNote]=useState(''), [child,setChild]=useState('')
  const today=now().toISODate()!
  const [completedOn,setCompletedOn]=useState(today)
  const status=useAction((next:string)=>rpc('transition_task',{target:id,next_status:next,note_text:note || null,
    completed_date:next==='submitted' ? completedOn : null}),workKeys,()=>setNote(''))
  const comment=useAction(()=>unwrap(db.from('task_comments').insert({task_id:id,body})),['task_comments'],()=>setBody(''))
  const task=query.data
  const assigned=assignees.data?.some(row=>row.user_id===user.id)
  const review=task?.status==='submitted' && task.reviewer_id===user.id && can(user,'task:review')
  if (child) return <TaskDetails key={child} user={user} id={child} close={()=>setChild('')}/>
  return <Dialog title={task?.title || 'Task details'} close={close}><div className="stack">
    <ErrorText issue={query.error || assignees.error || comments.error || history.error || children.error || status.error || comment.error}/>
    {query.isPending ? <Busy/> : !task ? <Empty title="This task is unavailable"/> : <>
      <div className="actions"><Status status={task.status}/><span className="badge">{task.priority} priority</span>{task.due_on && <span className="inline muted"><CalendarDays size={16}/> Due {pretty(task.due_on)}</span>}</div>
      {task.description && <p className="preserve">{task.description}</p>}
      <div className="task-people"><span><strong>Assignees</strong> {assignees.data?.map(row=>names(row.user_id)).join(', ') || '—'}</span><span><strong>Reviewer</strong> {names(task.reviewer_id)}</span>
        {task.submitted_by && <span><strong>Submitted by</strong> {names(task.submitted_by)}</span>}
        {task.work_completed_on && <span><strong>Work completed</strong> {pretty(task.work_completed_on)}</span>}
        {task.reviewed_by && <span><strong>Reviewed by</strong> {names(task.reviewed_by)}</span>}</div>
      {children.data?.length ? <div><h3>Subtasks</h3><div className="record-list">{children.data.map(row=><TaskRow key={row.id} task={row} open={setChild}/>)}</div></div> : null}
      {review && <Field label="Review note (optional)"><textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={4000} rows={2}/></Field>}
      {assigned && task.status==='in_progress' && <Field label="Work completed on">
        <input type="date" min={task.starts_on || undefined} max={today} value={completedOn} onChange={event=>setCompletedOn(event.target.value)} required/>
      </Field>}
      <div className="actions">
        {assigned && ['todo','needs_revision'].includes(task.status) && <Button variant="primary" disabled={status.isPending} onClick={()=>status.mutate('in_progress')}>Start work</Button>}
        {assigned && task.status==='in_progress' && <Button variant="primary" disabled={status.isPending || !completedOn || completedOn>today || !!task.starts_on && completedOn<task.starts_on}
          onClick={()=>status.mutate('submitted')}>Submit for review</Button>}
        {review && <><Button disabled={status.isPending} onClick={()=>status.mutate('needs_revision')}>Request revision</Button>
          <Button variant="primary" disabled={status.isPending} onClick={()=>status.mutate('completed')}>Approve completion</Button></>}
      </div>
      <div><h3>Comments</h3><div className="record-list">{comments.data?.map(item=><div key={item.id} className="record-row"><Avatar name={names(item.author_id)}/>
        <div><strong>{names(item.author_id)}</strong><small>{pretty(item.created_at)}</small><p className="preserve">{item.body}</p></div></div>)}</div></div>
      <form className="stack" onSubmit={e=>{e.preventDefault();comment.mutate()}}><Field label="Add a comment"><textarea value={body} onChange={e=>setBody(e.target.value)} rows={2} required maxLength={4000}/></Field>
        <div className="actions"><Button type="submit" disabled={comment.isPending || !body.trim()}>Post comment</Button></div></form>
      <div><h3>Activity history</h3><ul className="simple-list">{history.data?.map(item=><li key={item.id}><div><strong>{statusNames[item.status]}</strong><small>{names(item.actor_id)} · {pretty(item.created_at)}</small>{item.note && <p className="preserve">{item.note}</p>}</div></li>)}</ul></div>
    </>}
  </div></Dialog>
}

