import { useQuery } from '@tanstack/react-query'
import { Bell, Check, Download, FileText, Pencil, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { account,can,capabilities,day,db,downloadCsv,now,pretty,rpc,unwrap,useAction,useDirectory,useRows,values,type Alert,type Leave,type Notice,type Profile } from '../data'
import { Avatar,Busy,Button,Card,Dialog,Empty,ErrorText,Field,PageTitle,Status } from '../ui/controls'
import { useCategories } from '../calendar-data'
import { periodLabel,type ApprovedTask,type ReportPeriod } from '../accomplishments'
import AccomplishmentEditor from './AccomplishmentEditor'

export function LeavePage({user}:{user:Profile}) {
  const leave=useRows<Leave>('leave_requests'), people=useDirectory()
  const [open,setOpen]=useState(false)
  const submit=useAction((data:Record<string,string>)=>unwrap(db.from('leave_requests').insert({
    starts_on:data.starts_on,ends_on:data.ends_on,reason:data.reason,
  })),['leave_requests'],()=>setOpen(false))
  const review=useAction((data:{target:string;approve:boolean})=>rpc('review_leave',data),['leave_requests','calendar_events','notifications'])
  return <><PageTitle title="Leave" description="Submit requests and track their approval."><Button variant="primary" onClick={()=>{submit.reset();setOpen(true)}}><Plus size={17}/> Request leave</Button></PageTitle>
    <Card title={can(user,'leave:approve') ? 'Leave requests' : 'My requests'}>
      <ErrorText issue={leave.error || review.error}/>
      {leave.isPending ? <Busy/> : !leave.data?.length ? <Empty title="No leave requests"/> : <div className="record-list">
        {leave.data.map(item=><div className="record-row leave-row" key={item.id}>
          <Avatar name={people.data?.find(p=>p.id===item.requester_id)?.full_name || user.full_name}/>
          <div><strong>{item.requester_id===user.id ? 'My leave' : people.data?.find(p=>p.id===item.requester_id)?.full_name || 'Former employee'}</strong>
            <small>{pretty(item.starts_on)} – {pretty(item.ends_on)}</small><p className="preserve">{item.reason}</p></div>
          <Status status={item.status}/>
          {item.status==='pending' && item.requester_id!==user.id && can(user,'leave:approve') && <div className="actions">
            <Button size="small" onClick={()=>review.mutate({target:item.id,approve:false})} disabled={review.isPending}>Decline</Button>
            <Button size="small" variant="primary" onClick={()=>review.mutate({target:item.id,approve:true})} disabled={review.isPending}>Approve</Button>
          </div>}
        </div>)}</div>}
    </Card>
    {open && <Dialog title="Request leave" close={()=>setOpen(false)}><form className="form-grid" onSubmit={e=>{e.preventDefault();submit.mutate(values(e.currentTarget))}}>
      <Field label="First day"><input name="starts_on" type="date" required/></Field>
      <Field label="Last day"><input name="ends_on" type="date" required/></Field>
      <Field label="Reason (visible to leave reviewers)" wide><textarea name="reason" rows={4} maxLength={4000} required/></Field>
      <ErrorText issue={submit.error}/><div className="dialog-actions wide"><Button variant="primary" type="submit" disabled={submit.isPending}>Submit request</Button></div>
    </form></Dialog>}</>
}

export function Announcements({user}:{user:Profile}) {
  const notice=useRows<Notice>('announcements'), people=useDirectory()
  const [open,setOpen]=useState(false)
  const ack=useQuery({queryKey:['announcement_acknowledgements'],queryFn:()=>unwrap<{announcement_id:string;user_id:string}[]>(db.from('announcement_acknowledgements').select('announcement_id,user_id'))})
  const acknowledge=useAction((id:string)=>unwrap(db.from('announcement_acknowledgements').insert({announcement_id:id})),['announcement_acknowledgements'])
  const publish=useAction((input:Record<string,string>)=>unwrap(db.from('announcements').insert({title:input.title,body:input.body,acknowledgement_required:input.ack==='on'})),['announcements','notifications'],()=>setOpen(false))
  return <><PageTitle title="Announcements" description="Office notices and acknowledgements.">
    {can(user,'notices:manage') && <Button variant="primary" onClick={()=>{publish.reset();setOpen(true)}}><Plus size={17}/> Post notice</Button>}
  </PageTitle><ErrorText issue={notice.error || ack.error || acknowledge.error}/>
  {notice.isPending ? <Busy/> : notice.data?.length ? <div className="stack">{notice.data.map(item=>{
    const seen=ack.data?.some(row=>row.announcement_id===item.id && row.user_id===user.id)
    return <Card key={item.id} title={item.title} description={(people.data?.find(p=>p.id===item.author_id)?.full_name || 'Office')+' · '+pretty(item.created_at)}>
      <p className="article-body preserve">{item.body}</p>
      {item.acknowledgement_required && <div className="actions">{seen ? <span className="badge completed"><Check size={14}/> Acknowledged</span> :
        <Button onClick={()=>acknowledge.mutate(item.id)} disabled={acknowledge.isPending}>Acknowledge</Button>}
        {can(user,'notices:manage') && <span className="muted">{ack.data?.filter(row=>row.announcement_id===item.id).length || 0} acknowledgements</span>}</div>}
    </Card>
  })}</div> : <Card><Empty title="No announcements yet"/></Card>}
  {open && <Dialog title="Post announcement" close={()=>setOpen(false)}><form className="form-grid" onSubmit={e=>{e.preventDefault();publish.mutate(values(e.currentTarget))}}>
    <Field label="Title" wide><input name="title" required maxLength={160}/></Field>
    <Field label="Announcement" wide><textarea name="body" rows={6} required maxLength={10000}/></Field>
    <label className="check wide"><input type="checkbox" name="ack"/> Require staff acknowledgement</label>
    <ErrorText issue={publish.error}/><div className="dialog-actions wide"><Button variant="primary" type="submit" disabled={publish.isPending}>Publish</Button></div>
  </form></Dialog>}</>
}

export function Employees({user}:{user:Profile}) {
  const staff=useDirectory()
  const [search,setSearch]=useState(''),[editing,setEditing]=useState<{id:string;full_name:string}|null>(null)
  const save=useAction((name:string)=>account({action:'rename',id:editing!.id,full_name:name}),['directory','profile'],()=>setEditing(null))
  const people=staff.data?.filter(person=>(person.full_name+' '+person.designation).toLowerCase().includes(search.toLowerCase())) || []
  return <><PageTitle title="Employees" description="Find colleagues in the CIAS directory.">
    <label className="search"><Search size={16}/><input aria-label="Search employees" placeholder="Search employees" value={search} onChange={e=>setSearch(e.target.value)}/></label>
  </PageTitle><ErrorText issue={staff.error}/>{staff.isPending ? <Busy/> : people.length ? <div className="people-grid">{people.map(person=><Card key={person.id} className="person">
    <Avatar name={person.full_name} large/><div><h2>{person.full_name}</h2><p>{person.designation}</p></div>
    {can(user,'directory:edit') && <Button size="icon" variant="ghost" aria-label={'Edit '+person.full_name} onClick={()=>{save.reset();setEditing(person)}}><Pencil size={15}/></Button>}
    {person.id!==user.id && <Link className="text-link" to={'/messages?person='+person.id}>Message</Link>}
  </Card>)}</div> : <Card><Empty title="No employees found"/></Card>}
  {editing && <Dialog title="Edit directory name" close={()=>setEditing(null)}><form className="form-grid" onSubmit={e=>{e.preventDefault();save.mutate(values(e.currentTarget).full_name)}}>
    <Field label="Full name" wide><input name="full_name" required maxLength={120} defaultValue={editing.full_name}/></Field><ErrorText issue={save.error}/>
    <div className="dialog-actions wide"><Button type="submit" variant="primary" disabled={save.isPending}>Save name</Button></div>
  </form></Dialog>}</>
}

export function Notifications() {
  const alerts=useRows<Alert>('notifications')
  const mark=useAction(()=>rpc('mark_notifications'),['notifications'])
  return <><PageTitle title="Notifications" description="Invitations, approvals, assignments, and office updates.">
    <Button onClick={()=>mark.mutate()} disabled={mark.isPending || !alerts.data?.some(row=>!row.read_at)}><Check size={16}/> Mark all as read</Button>
  </PageTitle><Card><ErrorText issue={alerts.error || mark.error}/>
    {alerts.isPending ? <Busy/> : alerts.data?.length ? <div className="record-list">{alerts.data.map(item=><Link to={item.href} className="record-row" key={item.id}>
      <span className="stat-icon mint"><Bell size={16}/></span><div><strong>{item.title}</strong><small>{pretty(item.created_at)}</small></div>
      {!item.read_at && <span className="badge">Unread</span>}</Link>)}</div> : <Empty title="No notifications"/>}
  </Card></>
}

type ReportRow = {kind:string;reference:string;record_date:string;status:string}
export function Reports({user}:{user:Profile}) {
  const [period,setPeriod]=useState<ReportPeriod>(()=>({
    from_date:now().startOf('month').toISODate()!,to_date:now().endOf('month').toISODate()!,
  }))
  const [dirty,setDirty]=useState(false)
  const [error,setError]=useState('')
  const saved=useQuery({queryKey:['accomplishment-periods',user.id],queryFn:()=>unwrap<{period_start:string;period_end:string}[]>(
    db.from('accomplishment_report_drafts').select('period_start,period_end').eq('owner_id',user.id)
      .order('period_start',{ascending:false}).limit(100),
  )})
  const key=period.from_date+'|'+period.to_date
  function openPeriod(next:ReportPeriod) {
    const start=day(next.from_date),end=day(next.to_date)
    const span=end.diff(start,'days').days
    if (!start.isValid || !end.isValid || span<0 || span>365) {
      setError('Choose a valid period of up to one year.')
      return
    }
    setError('')
    if (next.from_date+'|'+next.to_date===key) return
    if (dirty && !window.confirm('Discard unsaved changes and open another reporting period?')) return
    setPeriod(next)
  }
  return <><PageTitle title="Reports" description="Prepare and export your accomplishment reports."/>
    <div className="stack">
      <Card title="Reporting period">
        <form className="report-filters" key={key} onSubmit={event=>{
          event.preventDefault()
          const dates=values(event.currentTarget)
          openPeriod({from_date:dates.from_date,to_date:dates.to_date})
        }}>
          <Field label="From"><input type="date" name="from_date" defaultValue={period.from_date} required/></Field>
          <Field label="Through"><input type="date" name="to_date" defaultValue={period.to_date} required/></Field>
          <Button type="submit">Apply dates</Button>
        </form>
        {!!saved.data?.length && <div className="compact-form"><Field label="Saved drafts">
          <select value={saved.data.some(record=>record.period_start+'|'+record.period_end===key) ? key : ''} onChange={event=>{
            const [from_date,to_date]=event.target.value.split('|')
            if (from_date && to_date) openPeriod({from_date,to_date})
          }}>
            <option value="">Choose a saved period</option>
            {saved.data.map(row=><option key={row.period_start+'|'+row.period_end} value={row.period_start+'|'+row.period_end}>
              {periodLabel({from_date:row.period_start,to_date:row.period_end})}
            </option>)}
          </select>
        </Field></div>}
        {error && <p role="alert" className="error">{error}</p>}
        <ErrorText issue={saved.error}/>
      </Card>
      <AccomplishmentEditor key={user.id+'|'+key} user={user} period={period} onDirty={setDirty}/>
      {can(user,'reports:view') && <OfficeReports user={user} range={period}/>}
    </div>
  </>
}

function OfficeReports({user,range}:{user:Profile;range:ReportPeriod}) {
  const [person,setPerson]=useState(user.id)
  const people=useDirectory()
  const report=useQuery({queryKey:['reports',range],queryFn:()=>rpc<ReportRow[]>('office_report',range)})
  const draft=useQuery({queryKey:['reports','draft',person,range],queryFn:()=>rpc<ApprovedTask[]>('accomplishment_draft',{staff_id:person,...range})})
  return <><Card title="Office report" description="Assignments, approved leave, and engagement records by date."
    action={<Button onClick={()=>downloadCsv(report.data || [],'cias-report.csv')} disabled={!report.data?.length}><Download size={17}/> Export CSV</Button>}>
    <ErrorText issue={report.error}/>{report.isPending ? <Busy/> : report.data?.length ? <div className="table-wrap"><table><thead><tr><th>Type</th><th>Record</th><th>Date</th><th>Status</th></tr></thead>
      <tbody>{report.data.map((row,i)=><tr key={i}><td>{row.kind}</td><td>{row.reference}</td><td>{pretty(row.record_date)}</td><td><Status status={row.status}/></td></tr>)}</tbody></table></div> : <Empty title="No records in this period"/>}
  </Card>
  <Card title="Employee task records" description="Approved tasks you have permission to see in the selected period."
    action={<Button size="small" disabled={!draft.data?.length} onClick={()=>downloadCsv((draft.data || []).map(row=>({
      draft_status:'Draft for review',employee:people.data?.find(entry=>entry.id===person)?.full_name,...row,
    })),'cias-accomplishment-draft.csv')}><Download size={15}/> Export CSV</Button>}>
    <div className="compact-form"><Field label="Employee"><select value={person} onChange={e=>setPerson(e.target.value)}>
      {(people.data || [user]).map(employee=><option key={employee.id} value={employee.id}>{employee.full_name}</option>)}</select></Field></div>
    <ErrorText issue={draft.error || people.error}/>
    {draft.isPending ? <Busy/> : draft.data?.length ? <div className="table-wrap"><table>
      <thead><tr><th>Approved task</th><th>Engagement</th><th>Work completed</th><th>Approval date</th><th>Review note</th></tr></thead>
      <tbody>{draft.data.map((row,i)=><tr key={i}><td>{row.task_title}</td><td>{row.engagement_code || '—'}</td><td>{pretty(row.completed_on)}</td><td>{pretty(row.approved_on)}</td>
        <td className="preserve">{row.approval_note || '—'}</td></tr>)}</tbody>
    </table></div> : <Empty title="No visible approved tasks in this period"/>}
  </Card></>
}

export function Settings({user}:{user:Profile}) {
  const [password,setPassword]=useState(false)
  const save=useAction((data:Record<string,string>)=>rpc('save_birthday',{month_number:data.month ? Number(data.month) : null,
    day_number:data.day ? Number(data.day) : null,visible:data.visible==='on'}),['profile','directory'])
  return <><PageTitle title="Settings" description="Manage your profile and account preferences."/>
    <div className="stack"><Card title="Profile"><div className="record-row"><Avatar name={user.full_name} large/><div><strong>{user.full_name}</strong><small>{user.designation} · @{user.username}</small></div></div></Card>
    <Card title="Birthday visibility" description="Share your birthday month and day on the office calendar. February 29 appears in leap years.">
      <form className="form-grid compact-form" onSubmit={e=>{e.preventDefault();save.mutate(values(e.currentTarget))}}>
        <Field label="Month (1–12)"><input name="month" type="number" min={1} max={12} defaultValue={user.birth_month}/></Field>
        <Field label="Day (1–31)"><input name="day" type="number" min={1} max={31} defaultValue={user.birth_day}/></Field>
        <label className="check wide"><input name="visible" type="checkbox" defaultChecked={user.birthday_visible}/> Show my birthday to CIAS staff</label>
        <div className="actions wide"><Button type="submit" variant="primary" disabled={save.isPending}>Save preferences</Button>{save.isSuccess && <span role="status">Preferences saved.</span>}</div>
        <ErrorText issue={save.error}/>
      </form>
    </Card>
    <Card title="Account security"><Button onClick={()=>setPassword(true)}>Change password</Button></Card></div>
    {password && <Dialog title="Change password" close={()=>setPassword(false)}><PasswordForm/></Dialog>}
  </>
}
export function PasswordForm() {
  const update=useAction(async (data:Record<string,string>)=>{
    if (data.password!==data.confirm) throw new Error('The new passwords do not match.')
    await account({action:'password',current:data.current,password:data.password})
    await db.auth.signOut({scope:'local'})
  },[])
  return <form className="stack" onSubmit={e=>{e.preventDefault();update.mutate(values(e.currentTarget))}}>
    <p className="muted">Use at least 12 characters with letters and numbers. You’ll sign in again after the change.</p>
    <Field label="Current password"><input name="current" type="password" autoComplete="current-password" required/></Field>
    <Field label="New password"><input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={72}/></Field>
    <Field label="Confirm password"><input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={72}/></Field>
    <ErrorText issue={update.error}/><Button type="submit" variant="primary" disabled={update.isPending}>Change password</Button>
  </form>
}

export function Administration({user}:{user:Profile}) {
  const categories=useCategories()
  const roster=useQuery({queryKey:['account-list'],enabled:user.system_role==='superadmin',queryFn:()=>account<{accounts:Profile[]}>({action:'list'})})
  const logs=useQuery({queryKey:['activity_logs'],enabled:user.system_role==='superadmin',
    queryFn:()=>unwrap<{id:number;entity:string;action:string;created_at:string;actor_id:string|null}[]>(db.from('activity_logs').select('*').order('id',{ascending:false}).limit(30))})
  const [editing,setEditing]=useState<Profile|'new'|null>(null),[reset,setReset]=useState<Profile|null>(null)
  const [createdUsername,setCreatedUsername]=useState('')
  const update=useAction(async (input:Record<string,unknown>)=>{
    const response=await account<{username?:string}>(input)
    if (input.action==='create' && response.username) setCreatedUsername(response.username)
  },['account-list','directory','activity_logs'],()=>{setEditing(null);setReset(null)})
  const categorySave=useAction((data:Record<string,string>)=>unwrap(db.from('event_categories').update({color:data.color,icon:data.icon}).eq('id',data.id)),['event_categories'])
  return <><PageTitle title="Administration" description="Manage office calendar settings and authorized accounts.">
    {user.system_role==='superadmin' && <Button variant="primary" onClick={()=>{update.reset();setCreatedUsername('');setEditing('new')}}><Plus size={17}/> Add account</Button>}
  </PageTitle><div className="stack">
    {user.system_role==='superadmin' && <>
      <Card title="Staff accounts" description="System roles and office capabilities are assigned independently.">
        {createdUsername && <p className="badge completed" role="status">Account created for <strong>{createdUsername}</strong></p>}
        <ErrorText issue={roster.error || update.error}/>{roster.isPending ? <Busy/> : <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>Username</th><th>System role</th><th>Account status</th><th>Actions</th></tr></thead><tbody>
          {roster.data?.accounts.map(person=><tr key={person.id}><td><strong>{person.full_name}</strong><small>{person.designation}</small></td><td>{person.username}</td>
            <td>{person.system_role}{person.admin_slot ? ' '+person.admin_slot : ''}</td><td>{person.active ? person.must_change_password ? 'First sign-in pending' : 'Active' : 'Deactivated'}</td>
            <td><div className="actions">{person.system_role!=='superadmin' && <><Button size="small" onClick={()=>{update.reset();setEditing(person)}}>Access</Button>
              <Button size="small" onClick={()=>{if(window.confirm((person.active ? 'Deactivate ' : 'Activate ')+person.full_name+'?')) update.mutate({action:'active',id:person.id,active:!person.active})}}> {person.active ? 'Deactivate' : 'Activate'}</Button></>}
              <Button size="small" onClick={()=>{update.reset();setReset(person)}}>Reset password</Button>
              <Button size="small" onClick={()=>{if(window.confirm('Revoke all sessions for '+person.full_name+'?')) update.mutate({action:'revoke',id:person.id})}}>Revoke sessions</Button></div></td>
          </tr>)}</tbody></table></div>}
      </Card>
      <Card title="Activity log" description="Recent account, engagement, and calendar actions.">
        <ErrorText issue={logs.error}/>{logs.data?.length ? <div className="record-list">{logs.data.map(row=><div className="record-row" key={row.id}><FileText size={16}/>
          <div><strong>{row.entity} · {row.action}</strong><small>{roster.data?.accounts.find(p=>p.id===row.actor_id)?.full_name || 'System'} · {pretty(row.created_at)}</small></div></div>)}</div> : <Empty title="No recorded activity"/>}
      </Card>
    </>}
    <Card title="Calendar categories" description="Set colors and icons for the ten office categories.">
      <ErrorText issue={categories.error || categorySave.error}/><div className="record-list">{categories.data?.map(category=><form className="record-row category-row" key={category.id}
        onSubmit={e=>{e.preventDefault();categorySave.mutate({...values(e.currentTarget),id:category.id})}}>
        <div><strong>{category.name}</strong><small>{category.description}</small></div>
        <input type="color" name="color" aria-label={category.name+' color'} defaultValue={category.color}/>
        <select name="icon" aria-label={category.name+' icon'} defaultValue={category.icon}>{['calendar','cake','users','building','plane','flag','book','sun','sparkles'].map(icon=><option key={icon}>{icon}</option>)}</select>
        <Button type="submit" size="small" disabled={categorySave.isPending}>Save</Button></form>)}</div>
    </Card>
  </div>
  {editing && <AccountEditor person={editing==='new' ? null : editing} close={()=>setEditing(null)} save={data=>update.mutate(data)} busy={update.isPending} issue={update.error}/>}
  {reset && <Dialog title={'Reset password for '+reset.username} close={()=>setReset(null)}><form className="form-grid" onSubmit={e=>{e.preventDefault();update.mutate({action:'reset',id:reset.id,password:values(e.currentTarget).password})}}>
    <Field label="Temporary password" wide><input name="password" type="password" required minLength={12} maxLength={72} autoComplete="new-password"/></Field>
    <p className="muted wide">This revokes existing sessions and requires a password change on the next sign-in.</p><ErrorText issue={update.error}/>
    <div className="dialog-actions wide"><Button variant="primary" type="submit" disabled={update.isPending}>Reset password</Button></div>
  </form></Dialog>}
  </>
}
function AccountEditor({person,close,save,busy,issue}:{person:Profile|null;close:()=>void;save:(data:Record<string,unknown>)=>void;busy:boolean;issue:unknown}) {
  const [role,setRole]=useState(person?.system_role || 'employee')
  return <Dialog title={person ? 'Edit access for '+person.username : 'Add staff account'} close={close}><form className="form-grid" onSubmit={e=>{
    e.preventDefault();const data=new FormData(e.currentTarget)
    save({...Object.fromEntries(data),id:person?.id,action:person?'access':'create',system_role:role,capabilities:data.getAll('capability')})
  }}>
    {!person && <>
      <Field label="First name"><input name="first_name" autoComplete="off" required maxLength={118}/></Field>
      <Field label="Last name"><input name="last_name" autoComplete="off" required maxLength={118}/></Field>
      <p className="muted wide">CIAS generates the username from the last name and sets the configured initial password.</p>
    </>}
    <Field label="Office designation"><input name="designation" defaultValue={person?.designation || 'Staff'} required maxLength={100}/></Field>
    <Field label="System role"><select value={role} onChange={e=>setRole(e.target.value)}><option value="employee">Employee</option><option value="admin">Admin</option></select></Field>
    {role==='admin' && <Field label="Admin slot"><select name="admin_slot" defaultValue={person?.admin_slot || 1}><option value={1}>Slot 1</option><option value={2}>Slot 2</option></select></Field>}
    <fieldset className="staff-picker wide"><legend>Office capabilities</legend><div>{capabilities.map(capability=><label key={capability}>
      <input type="checkbox" name="capability" value={capability} defaultChecked={person?.capabilities.includes(capability)}/>{capability}</label>)}</div></fieldset>
    <ErrorText issue={issue}/><div className="dialog-actions wide"><Button type="submit" variant="primary" disabled={busy}>Save account</Button></div>
  </form></Dialog>
}

