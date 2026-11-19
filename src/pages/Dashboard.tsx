import { ArrowDownRight, ArrowRight, BellRing, CalendarDays, Cake, ChevronLeft, ChevronRight, ClipboardList, FolderOpen, ListChecks, Megaphone, MessageSquare } from 'lucide-react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { can,day,db,now,pretty,rpc,unwrap,useDirectory,useRows,type Alert,type Engagement,type Notice,type Profile,type Task } from '../data'
import { birthdayEvents,expandEvents } from '../recurrence'
import { Avatar,Button,Card,Empty,ErrorText,Status } from '../ui/controls'
import { useCategories,useEvents,useExceptions } from '../calendar-data'

export default function Dashboard({user}:{user:Profile}) {
  const today=now()
  const [month,setMonth]=useState(today.startOf('month'))
  const [activeDay,setActiveDay]=useState(today.toISODate()!)
  const from = month.startOf('week').toUTC().toISO()!
  const to = month.endOf('month').endOf('week').plus({milliseconds:1}).toUTC().toISO()!
  const events=useEvents(from,to), exceptions=useExceptions(), categories=useCategories(), people=useDirectory()
  const tasks=useRows<Task>('tasks'), notices=useRows<Notice>('announcements','created_at',4)
  const engagements=useRows<Engagement>('audit_engagements','created_at',5), activity=useRows<Alert>('notifications','created_at',4)
  const assigned=useQuery({queryKey:['task_assignees','mine',user.id],queryFn:()=>unwrap<{task_id:string}[]>(db.from('task_assignees').select('task_id').eq('user_id',user.id))})
  const unread=useQuery({queryKey:['conversation_unread'],queryFn:()=>rpc<{unread:number}[]>('conversation_unread'),refetchInterval:15000})
  const work=(tasks.data || []).filter(task=>assigned.data?.some(row=>row.task_id===task.id))
  const open=work.filter(item=>item.status!=='completed')
  const overdue=open.filter(item=>!!item.due_on && item.due_on<today.toISODate()!)
  const dueSoon=open.filter(item=>!!item.due_on && item.due_on>=today.toISODate()! && item.due_on<=today.plus({days:7}).toISODate()!)
  const reviews=(tasks.data || []).filter(item=>item.reviewer_id===user.id && item.status==='submitted')
  const birthdays=(people.data || []).filter(person=>person.birth_month===today.month)
  const schedule=expandEvents([...(events.data || []),...birthdayEvents(people.data || [])],exceptions.data || [],from,to)
  const upcoming=schedule.filter(item=>day(item.start).toISODate()!>=activeDay)
  const weekStart=month.startOf('week')
  const calendarDays=Array.from({length:Math.round(month.endOf('month').endOf('week').startOf('day').diff(weekStart,'days').days)+1},
    (_,index)=>weekStart.plus({days:index}))
  const stats=[
    {label:'Open tasks',value:open.length,detail:overdue.length ? overdue.length+' overdue' : dueSoon.length+' due within 7 days',icon:ClipboardList,to:'/tasks',className:'mint'},
    {label:'Upcoming events',value:upcoming.length,detail:'In the displayed period',icon:CalendarDays,to:'/',className:'blue'},
    {label:'Unread messages',value:(unread.data || []).reduce((sum,row)=>sum+row.unread,0),detail:'Across your conversations',icon:MessageSquare,to:'/messages',className:'violet'},
    {label:'My engagements',value:engagements.data?.length || 0,detail:'Audit workspaces',icon:FolderOpen,to:'/engagements',className:'sand'},
  ]
  function moveMonth(step:number) {
    const next=month.plus({months:step})
    setMonth(next)
    setActiveDay(next.hasSame(today,'month') ? today.toISODate()! : next.toISODate()!)
  }
  return <>
    <div className="dashboard-date"><span><CalendarDays size={15}/>{today.toFormat('EEEE, MMMM d, yyyy')}</span>
      <Button asChild size="small"><Link to="/"><CalendarDays size={15}/> Calendar <ArrowRight size={14}/></Link></Button>
    </div>
    <section className="welcome">
      <div className="welcome-art" aria-hidden="true"><i/><i/><i/><i/></div>
      <div className="welcome-content"><p><span/> CITY INTERNAL AUDIT SERVICES</p>
        <h1>Welcome, {user.full_name.split(' ')[0]}.</h1>
        <div>Your work, schedule, and team in one place.</div>
        <Button asChild className="hero-button"><Link to="/tasks">View my tasks <ArrowRight size={16}/></Link></Button>
      </div>
    </section>
    <div className="stat-grid">
      {stats.map(({label,value,detail,icon:Icon,to,className})=><Link className="stat card" key={label} to={to}>
        <div><span className={'stat-icon '+className}><Icon size={19}/></span><ArrowDownRight className="stat-arrow" size={16}/></div>
        <strong>{value}</strong><h2>{label}</h2><p>{detail}</p></Link>)}
    </div>
    <ErrorText issue={events.error || exceptions.error || people.error || assigned.error || tasks.error || notices.error || unread.error || engagements.error || activity.error}/>
    <div className="dashboard-grid">
      <Card title="Office schedule" description="Upcoming events in Philippine time" action={<Link className="text-link" to="/">Full calendar <ArrowRight size={14}/></Link>}>
        <div className="schedule-grid">
          <div className="mini-calendar">
            <div className="mini-head"><strong>{month.toFormat('MMMM yyyy')}</strong><div className="actions">
              <Button variant="ghost" size="icon" aria-label="Previous month" onClick={()=>moveMonth(-1)}><ChevronLeft size={16}/></Button>
              <Button variant="ghost" size="icon" aria-label="Next month" onClick={()=>moveMonth(1)}><ChevronRight size={16}/></Button>
            </div></div>
            <div className="date-grid">
              {['M','T','W','T','F','S','S'].map((label,index)=><span key={index}>{label}</span>)}
              {calendarDays.map(date=>{
                const iso=date.toISODate()!
                return <button key={iso} className={[(date.month!==month.month?'outside':''),(iso===activeDay?'chosen':'')].join(' ')}
                  aria-label={date.toFormat('MMMM d, yyyy')} aria-pressed={activeDay===iso} onClick={()=>setActiveDay(iso)}>
                  {date.day}{schedule.some(item=>day(item.start).toISODate()===iso) && <i/>}
                </button>
              })}
            </div>
          </div>
          <div className="agenda">
            {upcoming.length ? upcoming.slice(0,4).map(item=>{
              const category=categories.data?.find(row=>row.id===item.event.category_id)
              return <Link className="agenda-row" key={item.id} to="/">
                <span style={{background:category?.color}}/><div><strong>{item.title}</strong>
                <small>{day(item.start).toFormat('EEE, MMM d')} · {item.allDay ? 'All day' : day(item.start).toFormat('h:mm a')}</small></div>
              </Link>
            }) : <Empty title="No upcoming events" detail="Select another date to see the office schedule."/>}
          </div>
        </div>
      </Card>
      <Card title="Announcements" description="Latest notices from the office" action={<Link className="text-link" to="/announcements">View all <ArrowRight size={14}/></Link>}>
        {notices.data?.length ? <div className="record-list">{notices.data.map(item=><Link to="/announcements" key={item.id} className="record-row"><span className="stat-icon sand"><Megaphone size={17}/></span>
          <div><strong>{item.title}</strong><small>{pretty(item.created_at)}</small></div></Link>)}</div> :
          <Empty title="You're all caught up" detail="New office notices will appear here."/>}
      </Card>
      <Card title="My assignments" action={<Link className="text-link" to="/tasks">View tasks <ArrowRight size={14}/></Link>}>
        {open.length ? <div className="record-list">{open.slice(0,5).map(item=><Link key={item.id} to={'/tasks?task='+item.id} className="record-row"><ListChecks size={18}/>
          <div><strong>{item.title}</strong><small>{item.due_on ? 'Due '+pretty(item.due_on) : 'No due date'}</small></div><Status status={item.status}/></Link>)}</div> : <Empty title="No open assignments"/>}
      </Card>
      {can(user,'task:review') && <Card title="Pending reviews" action={<Link className="text-link" to="/tasks">Review queue <ArrowRight size={14}/></Link>}>
        {reviews.length ? <div className="record-list">{reviews.map(item=><Link key={item.id} to={'/tasks?task='+item.id} className="record-row"><ListChecks size={18}/><strong>{item.title}</strong><Status status={item.status}/></Link>)}</div> : <Empty title="No tasks awaiting review"/>}
      </Card>}
      <Card title="My engagements" action={<Link className="text-link" to="/engagements">View all <ArrowRight size={14}/></Link>}>
        {engagements.data?.length ? <div className="record-list">{engagements.data.map(item=><Link key={item.id} to={'/engagements/'+item.id} className="record-row"><FolderOpen size={18}/><div><strong>{item.title}</strong><small>{item.code} · {item.audited_office}</small></div></Link>)}</div> :
          <Empty title="No assigned engagements"/>}
      </Card>
      <Card title="Birthdays this month" action={<Link className="text-link" to="/employees">Directory <ArrowRight size={14}/></Link>}>
        {birthdays.length ? <div className="record-list">{birthdays.map(person=><Link to="/employees" key={person.id} className="record-row"><Avatar name={person.full_name}/><div><strong>{person.full_name}</strong><small>{today.toFormat('MMMM')} {person.birth_day}</small></div><Cake size={18}/></Link>)}</div> : <Empty title="No shared birthdays this month"/>}
      </Card>
      <Card title="Recent activity" action={<Link className="text-link" to="/notifications">Notifications <ArrowRight size={14}/></Link>}>
        {activity.data?.length ? <div className="record-list">{activity.data.map(item=><Link to={item.href} key={item.id} className="record-row"><BellRing size={18}/><div><strong>{item.title}</strong><small>{pretty(item.created_at)}</small></div></Link>)}</div> : <Empty title="No recent activity"/>}
      </Card>
    </div>
  </>
}

