import { DateTime } from 'luxon'
import { useQuery } from '@tanstack/react-query'
import { BookOpen, Building2, Cake, CalendarDays, CalendarPlus, Clock3, Download, Flag, MapPin, Plane, Sparkles, Sun, Upload, UsersRound } from 'lucide-react'
import { useState,type FormEvent } from 'react'
import Papa from 'papaparse'
import { can,day,db,localInput,now,pickerValue,rpc,unwrap,useAction,useDirectory,values,ZONE,type Engagement,type Profile } from '../data'
import { birthdayEvents,buildRule,expandEvents,weekdays,weekdayLabels,type Category,type EventRow,type Occurrence } from '../recurrence'
import { Button,Dialog,ErrorText,Field,PageTitle,StaffPicker } from '../ui/controls'
import { CalendarBoard,initialCalendarRange } from '../ui/CalendarBoard'
import { pages,useCategories,useEvents,useExceptions } from '../calendar-data'

const invalidate = ['calendar_events','event_exceptions','event_attendees','event_rsvps','event_history','notifications']
const icons = {calendar:CalendarDays,cake:Cake,users:UsersRound,building:Building2,plane:Plane,flag:Flag,book:BookOpen,sun:Sun,sparkles:Sparkles}

export default function Calendar({user}:{user:Profile}) {
  const [windowDates,setWindowDates] = useState(initialCalendarRange)
  const [filter,setFilter] = useState(''), [scope,setScope] = useState('')
  const [editor,setEditor] = useState<EventRow | 'new' | null>(null)
  const [selected,setSelected] = useState<Occurrence | null>(null)
  const [importing,setImporting] = useState(false)
  const categories = useCategories(), people = useDirectory()
  const events = useEvents(windowDates[0],windowDates[1]), exceptions = useExceptions()
  const engagements = useQuery({queryKey:['audit_engagements'],queryFn:() => unwrap<Engagement[]>(db.from('audit_engagements').select('*').order('title'))})
  const items = expandEvents([...(events.data || []),...birthdayEvents(people.data || [])],exceptions.data || [],...windowDates)
    .filter(item => (!filter || item.event.category_id===filter) && (!scope || item.event.engagement_id===scope))
  return <><PageTitle title="Calendar" description="Office events, scheduled duties, and approved leave.">
    {can(user,'calendar:manage') && <Button onClick={() => setImporting(true)}><Upload size={16}/> Import CSV</Button>}
    <Button variant="primary" onClick={() => setEditor('new')}><CalendarPlus size={17}/> New event</Button>
  </PageTitle>
  <CalendarBoard items={items} onRangeChange={setWindowDates} onSelect={setSelected}
    colorFor={item => categories.data?.find(category => category.id===item.event.category_id)?.color} filters={<>
      <select aria-label="Category" value={filter} onChange={e => setFilter(e.target.value)}><option value="">All categories</option>
        {categories.data?.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
      {!!engagements.data?.length && <select aria-label="Engagement filter" value={scope} onChange={e => setScope(e.target.value)}><option value="">All workspaces</option>
        {engagements.data.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>}
    </>}>
    <ErrorText issue={events.error || exceptions.error || categories.error || people.error}/>
  </CalendarBoard>
  {selected && <EventDetails item={selected} user={user} people={people.data || []} category={categories.data?.find(c=>c.id===selected.event.category_id)} close={() => setSelected(null)}
    edit={() => { setEditor(selected.event); setSelected(null) }}/>}
  {editor && <EventEditor event={editor==='new' ? null : editor} user={user} categories={categories.data || []}
    engagements={engagements.data || []} close={() => setEditor(null)}/>}
  {importing && <ImportEvents categories={categories.data || []} close={() => setImporting(false)}/>}
  </>
}

function EventEditor({event,user,categories,engagements,close}:{event:EventRow|null;user:Profile;categories:Category[];engagements:Engagement[];close:()=>void}) {
  const parts = Object.fromEntries((event?.rrule || '').split(';').map(piece => piece.split('=') as [string,string]))
  const [repeat,setRepeat] = useState(parts.BYSETPOS ? 'monthly_nth' : parts.FREQ?.toLowerCase() || 'never')
  const [endType,setEndType] = useState(parts.COUNT ? 'count' : parts.UNTIL ? 'date' : 'never')
  const [days,setDays] = useState(parts.BYDAY?.split(',') || [])
  const [allDay,setAllDay] = useState(event?.all_day || false)
  const [visibility,setVisibility] = useState(event?.visibility || (can(user,'calendar:manage') ? 'office' : 'private'))
  const people = useDirectory()
  const existing = useQuery({queryKey:['event_attendees',event?.id],enabled:!!event,
    queryFn:() => unwrap<{user_id:string}[]>(db.from('event_attendees').select('user_id').eq('event_id',event!.id))})
  const [draft,setDraft] = useState<string[]|null>(null)
  const attendees = draft ?? (existing.data || []).map(row => row.user_id)
  const action = useAction(async (data:Record<string,string>) => {
    const end = data.ends ? (allDay ? day(data.ends).plus({days:1}).toUTC().toISO() : pickerValue(data.ends)) : allDay ? day(data.starts).plus({days:1}).toUTC().toISO() : null
    return rpc('save_event',{target:event?.id ?? null,data:{title:data.title,description:data.description,location:data.location,
      meeting_url:data.meeting_url,category_id:data.category_id,starts_at:pickerValue(data.starts),ends_at:end,all_day:allDay,
      visibility,engagement_id:visibility==='engagement' ? data.engagement_id : null,rrule:buildRule({...data,repeat,end_type:endType},days)},
      attendees:visibility==='private' ? [] : attendees})
  },invalidate,close)
  const remove = useAction(() => rpc('remove_event',{target:event!.id}),invalidate,close)
  const inputType = allDay ? 'date' : 'datetime-local'
  const defaultEnd = allDay && event?.ends_at ? day(event.ends_at).minus({days:1}).toISODate()! : localInput(event?.ends_at,allDay)
  return <Dialog title={event ? 'Edit event series' : 'New event'} close={close}>
    <form className="form-grid" onSubmit={e => { e.preventDefault(); action.mutate(values(e.currentTarget)) }}>
      <Field label="Title" wide><input name="title" required maxLength={160} defaultValue={event?.title}/></Field>
      <Field label="Category"><select name="category_id" defaultValue={event?.category_id || 'activity'}>{categories.filter(c => c.id!=='leave').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Visibility"><select value={visibility} onChange={e=>setVisibility(e.target.value)}>
        <option value="private">Private</option>{can(user,'calendar:manage') && <><option value="office">Office</option><option value="selected">Selected employees</option></>}
        {can(user,'engagement:create') && <option value="engagement">Engagement members</option>}</select></Field>
      {visibility==='engagement' && <Field label="Engagement" wide><select name="engagement_id" required defaultValue={event?.engagement_id || ''}>
        <option value="" disabled>Choose an engagement</option>{engagements.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></Field>}
      <label className="check wide"><input type="checkbox" checked={allDay} onChange={e=>setAllDay(e.target.checked)}/> All-day event</label>
      <Field label={allDay ? 'Start date' : 'Starts (Philippine time)'}><input key={inputType+'start'} name="starts" type={inputType} required
        defaultValue={localInput(event?.starts_at || now().startOf('hour').plus({hours:1}).toISO(),allDay)}/></Field>
      <Field label={allDay ? 'Last day (optional)' : 'Ends (optional)'}><input key={inputType+'end'} name="ends" type={inputType} defaultValue={defaultEnd}/></Field>
      <Field label="Location"><input name="location" defaultValue={event?.location}/></Field>
      <Field label="Meeting link"><input name="meeting_url" type="url" placeholder="https://" defaultValue={event?.meeting_url || ''}/></Field>
      <Field label="Description" wide><textarea name="description" rows={2} defaultValue={event?.description}/></Field>
      <Field label="Repeats"><select value={repeat} onChange={e=>setRepeat(e.target.value)}>
        <option value="never">Never</option><option value="daily">Daily</option><option value="weekly">Weekly</option>
        <option value="monthly">Monthly on a date</option><option value="monthly_nth">Monthly on a weekday</option><option value="yearly">Yearly</option>
      </select></Field>
      {repeat!=='never' && <>
        <Field label="Repeat every (periods)"><input name="interval" type="number" min={1} max={365} defaultValue={parts.INTERVAL || 1} required/></Field>
        {(repeat==='daily' || repeat==='weekly') && <fieldset className="wide weekday-picker"><legend>{repeat==='daily' ? 'Limit to weekdays (optional)' : 'Weekdays'}</legend>
          {weekdays.map((code,i) => <label key={code}><input type="checkbox" checked={days.includes(code)} onChange={e=>setDays(e.target.checked ? [...days,code] : days.filter(dayCode=>dayCode!==code))}/>{weekdayLabels[i]}</label>)}</fieldset>}
        {repeat==='monthly' && <Field label="Day of month (shorter months are skipped)" wide><input name="monthday" type="number" min={1} max={31} defaultValue={parts.BYMONTHDAY} placeholder="Use start date"/></Field>}
        {repeat==='monthly_nth' && <>
          <Field label="Week of the month"><select name="position" defaultValue={parts.BYSETPOS || '-1'}>
            {['First','Second','Third','Fourth','Last'].map((label,i) => <option key={label} value={i===4 ? -1 : i+1}>{label}</option>)}</select></Field>
          <Field label="Weekday"><select name="weekday" defaultValue={parts.BYDAY || 'FR'}>{weekdays.map((code,i)=><option key={code} value={code}>{weekdayLabels[i]}</option>)}</select></Field>
        </>}
        {repeat==='yearly' && <><Field label="Month (defaults to start month)"><input name="yearmonth" type="number" min={1} max={12} defaultValue={parts.BYMONTH}/></Field>
          <Field label="Day (Feb 29 appears in leap years)"><input name="yearday" type="number" min={1} max={31} defaultValue={parts.BYMONTHDAY}/></Field></>}
        <Field label="Series ends"><select value={endType} onChange={e=>setEndType(e.target.value)}><option value="never">Never</option><option value="count">After a number of dates</option><option value="date">On a date</option></select></Field>
        {endType==='count' && <Field label="Number of dates"><input name="occurrence_count" type="number" min={1} max={10000} required defaultValue={parts.COUNT}/></Field>}
        {endType==='date' && <Field label="Final date"><input name="until" type="date" required defaultValue={parts.UNTIL ?
          DateTime.fromFormat(parts.UNTIL,"yyyyMMdd'T'HHmmss'Z'",{zone:'UTC'}).setZone(ZONE).toISODate() || undefined : undefined}/></Field>}
      </>}
      {visibility!=='private' && <StaffPicker label="Invite attendees" people={people.data || []} selected={attendees} setSelected={setDraft}/>}
      {event?.rrule && <p className="muted wide">Changing the start or recurrence pattern clears previous occurrence exceptions and responses.</p>}
      <ErrorText issue={action.error || remove.error || existing.error}/>
      <div className="dialog-actions wide">
        {event && <Button variant="danger" disabled={remove.isPending} onClick={() => { if (window.confirm('Delete this event and all its dates?')) remove.mutate() }}>Delete event</Button>}
        <Button type="submit" variant="primary" disabled={action.isPending || existing.isPending && !!event}>Save event</Button>
      </div>
    </form>
  </Dialog>
}
function EventDetails({item,user,people,category,close,edit}:{item:Occurrence;user:Profile;people:{id:string;full_name:string}[];category?:Category;close:()=>void;edit:()=>void}) {
  const event = item.event
  const birthday = event.id.startsWith('birthday-')
  const [editing,setEditing] = useState(false)
  const editor = !event.managed_leave && !birthday && (event.owner_id===user.id || event.visibility==='office' && can(user,'calendar:manage'))
  const history = useQuery({queryKey:['event_history',event.id],enabled:editor,
    queryFn:() => rpc<{id:number;action:string;created_at:string}[]>('event_history',{target:event.id})})
  const invitees = useQuery({queryKey:['event_attendees',event.id],enabled:!birthday,
    queryFn:() => unwrap<{user_id:string}[]>(db.from('event_attendees').select('user_id').eq('event_id',event.id))})
  const replies = useQuery({queryKey:['event_rsvps',event.id,item.original],enabled:!birthday,
    queryFn:() => unwrap<{user_id:string;response:string}[]>(db.from('event_rsvps').select('user_id,response').eq('event_id',event.id).eq('occurrence_at',item.original))})
  const response = useAction((choice:string) => rpc('rsvp',{target:event.id,occurrence:item.original,choice}),invalidate)
  const reminderTime = day(item.start).minus({minutes:30})
  const reminder = useAction(() => rpc('set_event_reminder',{target:event.id,occurrence:item.original,reminder_at:reminderTime.toUTC().toISO()}),[])
  const change = useAction((data:Record<string,string>|null) => rpc('save_occurrence',{target:event.id,original_start:item.original,
    cancel:data===null,new_title:data?.title || null,new_start:data ? pickerValue(data.start) : null,
    new_end:data?.end ? (item.allDay ? day(data.end).plus({days:1}).toUTC().toISO() : pickerValue(data.end)) :
      data && item.allDay ? day(data.start).plus({days:1}).toUTC().toISO() : null}),invalidate,close)
  const timeLabel = item.allDay ? day(item.start).toFormat('EEEE, MMMM d, yyyy') +
    (item.end && day(item.end).diff(day(item.start),'days').days>1 ? ' – '+day(item.end).minus({days:1}).toFormat('MMM d, yyyy') : '') :
    day(item.start).toFormat('EEEE, MMMM d, yyyy · h:mm a')+(item.end ? ' – '+day(item.end).toFormat('h:mm a') : '')
  const inputType = item.allDay ? 'date' : 'datetime-local'
  const CategoryIcon = icons[category?.icon as keyof typeof icons] || CalendarDays
  return <Dialog title={item.title} close={close}>
    <div className="stack"><p className="inline"><Clock3 size={17}/>{timeLabel}</p>
      {category && <p className="inline"><CategoryIcon size={17}/>{category.name}</p>}
      {event.location && <p className="inline"><MapPin size={17}/>{event.location}</p>}{event.description && <p className="preserve">{event.description}</p>}
      {event.meeting_url && <a className="text-link" href={event.meeting_url} target="_blank" rel="noreferrer">Open meeting link</a>}
      {event.rrule && <span className="badge">Recurring event</span>}
      {!!invitees.data?.length && <div><h3>Attendance</h3><ul className="simple-list">{invitees.data.map(row => <li key={row.user_id}>
        {people.find(person => person.id===row.user_id)?.full_name || 'Former employee'} <span className="badge">{replies.data?.find(reply=>reply.user_id===row.user_id)?.response || 'invited'}</span></li>)}</ul></div>}
      {invitees.data?.some(person => person.user_id===user.id) && <div className="actions">{['accepted','tentative','declined'].map((choice,i)=><Button key={choice} size="small"
        variant={replies.data?.find(row=>row.user_id===user.id)?.response===choice ? 'primary':'outline'} onClick={()=>response.mutate(choice)}>{['Accept','Tentative','Decline'][i]}</Button>)}</div>}
      {!birthday && reminderTime.toMillis()>now().toMillis() && <div><Button size="small" disabled={reminder.isPending || reminder.isSuccess} onClick={()=>reminder.mutate()}>{reminder.isSuccess ? 'Reminder set' : 'Remind me 30 minutes before'}</Button></div>}
      {editor && <div className="actions">
        {event.rrule && <><Button onClick={()=>setEditing(!editing)}>Edit this date</Button>
          <Button variant="danger" onClick={()=>{ if(window.confirm('Cancel this date?')) change.mutate(null) }}>Cancel this date</Button></>}
        <Button onClick={edit}>{event.rrule ? 'Edit entire series' : 'Edit event'}</Button>
      </div>}
      {editing && <form className="form-grid" onSubmit={(e:FormEvent<HTMLFormElement>)=>{e.preventDefault();change.mutate(values(e.currentTarget))}}>
        <Field label="Title" wide><input name="title" required defaultValue={item.title}/></Field>
        <Field label="Starts"><input name="start" type={inputType} required defaultValue={localInput(item.start,item.allDay)}/></Field>
        <Field label={item.allDay ? 'Last day' : 'Ends'}><input name="end" type={inputType} defaultValue={item.allDay && item.end ? day(item.end).minus({days:1}).toISODate()! : localInput(item.end,item.allDay)}/></Field>
        <div className="dialog-actions wide"><Button type="submit" variant="primary" disabled={change.isPending}>Save this date</Button></div>
      </form>}
      {editor && !!history.data?.length && <details><summary>Event history</summary><ul className="simple-list">{history.data.map(line=>
        <li key={line.id}><span>{line.action}</span><small>{day(line.created_at).toFormat('MMM d, yyyy · h:mm a')}</small></li>)}</ul></details>}
      <ErrorText issue={response.error || change.error || reminder.error || invitees.error || replies.error || history.error}/>
    </div>
  </Dialog>
}

type ImportRow = { title:string; category_id:string; starts_at:string; ends_at:string|null; visibility:string; description:string; all_day:boolean }
function ImportEvents({categories,close}:{categories:Category[];close:()=>void}) {
  const [rows,setRows] = useState<ImportRow[]>([])
  const [message,setMessage] = useState('')
  const existing = useQuery({queryKey:['calendar_events','import'],queryFn:() => pages<Pick<EventRow,'title'|'starts_at'>>((a,b)=>db.from('calendar_events').select('title,starts_at').eq('visibility','office').order('id').range(a,b))})
  const insert = useAction((records:ImportRow[]) => rpc('import_events',{records}),invalidate,close)
  return <Dialog title="Import calendar CSV" close={close}>
    <p className="muted">Use the template headers and enter dates as YYYY-MM-DD or YYYY-MM-DDTHH:mm in Philippine time. Duplicate titles at the same start time are skipped.</p>
    <Button onClick={() => { const link=document.createElement('a'); link.href='data:text/csv,title,category,start,end,description%0A'; link.download='cias-calendar-template.csv'; link.click() }}><Download size={16}/> Download template</Button>
    <Field label="Calendar file" wide><input disabled={existing.isPending || !!existing.error} type="file" accept=".csv,text/csv" onChange={e=>{
      const file=e.target.files?.[0]; if (!file) return
      setRows([]); setMessage('')
      if (file.size > 1024*1024) {setMessage('Choose a CSV smaller than 1 MB.'); return}
      Papa.parse<Record<string,string>>(file,{header:true,skipEmptyLines:'greedy',complete:report=>{
        if (report.errors.length || !['title','category','start'].every(header=>report.meta.fields?.includes(header))) {setMessage('The CSV needs title, category, and start headers with well-formed rows.'); return}
        const key = (title:string,start:string) => title.trim().toLowerCase()+'|'+new Date(start).toISOString()
        const seen=new Set(existing.data?.map(item=>key(item.title,item.starts_at)))
        let skipped=0
        const valid:ImportRow[]=[]
        for (const row of report.data) {
          const category=categories.find(c=>c.id!=='leave' && c.name.toLowerCase()===row.category?.trim().toLowerCase())
          const start=day(row.start || ''), end=row.end ? day(row.end) : null
          const allDay=/^\d{4}-\d{2}-\d{2}$/.test(row.start || '')
          const finalEnd=allDay ? (end || start).plus({days:1}) : end
          if (!row.title?.trim() || row.title.length>160 || !category || !start.isValid || finalEnd && (!finalEnd.isValid || finalEnd<=start)) {skipped++; continue}
          const startValue=start.toUTC().toISO()!
          const unique=key(row.title,startValue)
          if (seen.has(unique)) {skipped++; continue}
          seen.add(unique)
          valid.push({title:row.title.trim(),category_id:category.id,starts_at:startValue,ends_at:finalEnd?.toUTC().toISO() || null,
            description:row.description || '',visibility:'office',all_day:allDay})
        }
        if(valid.length>500) {setMessage('Import up to 500 valid entries per file.');return}
        setRows(valid);setMessage(valid.length+' ready to import · '+skipped+' invalid or duplicate')
      }})
    }}/></Field>
    {message && <p role="status">{message}</p>}{!!rows.length && <ul className="simple-list">{rows.slice(0,8).map(row=><li key={row.title+row.starts_at}>{row.title} <span>{day(row.starts_at).toFormat('MMM d, yyyy')}</span></li>)}</ul>}
    <ErrorText issue={existing.error || insert.error}/>
    <div className="dialog-actions"><Button variant="primary" disabled={!rows.length || insert.isPending} onClick={()=>insert.mutate(rows)}>Import {rows.length || ''} events</Button></div>
  </Dialog>
}

