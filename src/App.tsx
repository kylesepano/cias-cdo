import { zodResolver } from '@hookform/resolvers/zod'
import type { Session } from '@supabase/supabase-js'
import { useQuery,useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Bell, CalendarDays, ChevronDown, ClipboardList, Eye, EyeOff, FileChartColumn, FolderOpen, LayoutDashboard, LockKeyhole, LogOut, Megaphone, Menu, MessageSquare, Settings as SettingsIcon, Shield, Umbrella, UsersRound, X } from 'lucide-react'
import { lazy,Suspense,useEffect,useRef,useState,type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { Link,NavLink,Navigate,Route,Routes,useLocation } from 'react-router-dom'
import { z } from 'zod'
import { account,can,configured,db,now,unwrap,useRows,type Alert,type Profile } from './data'
import { Avatar,Brand,Busy,Button,ErrorText,Field } from './ui/controls'

const Dashboard=lazy(()=>import('./pages/Dashboard'))
const Calendar=lazy(()=>import('./pages/Calendar'))
const SignedOutCalendar=lazy(()=>import('./pages/SignedOutCalendar'))
const Messages=lazy(()=>import('./pages/Messages'))
const Tasks=lazy(()=>import('./pages/Work').then(module=>({default:module.Tasks})))
const Engagements=lazy(()=>import('./pages/Work').then(module=>({default:module.Engagements})))
const Workspace=lazy(()=>import('./pages/Work').then(module=>({default:module.Workspace})))
const Announcements=lazy(()=>import('./pages/Operations').then(module=>({default:module.Announcements})))
const Leave=lazy(()=>import('./pages/Operations').then(module=>({default:module.LeavePage})))
const Employees=lazy(()=>import('./pages/Operations').then(module=>({default:module.Employees})))
const Notifications=lazy(()=>import('./pages/Operations').then(module=>({default:module.Notifications})))
const Reports=lazy(()=>import('./pages/Operations').then(module=>({default:module.Reports})))
const Settings=lazy(()=>import('./pages/Operations').then(module=>({default:module.Settings})))
const Administration=lazy(()=>import('./pages/Operations').then(module=>({default:module.Administration})))
const PasswordForm=lazy(()=>import('./pages/Operations').then(module=>({default:module.PasswordForm})))

const identity=z.object({username:z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{0,31}$/, 'Enter a valid username.'),
  password:z.string().min(1,'Enter your password.').max(128)})
const nav = [
  {title:'WORKSPACE',items:[
    {href:'/',label:'Calendar',icon:CalendarDays},{href:'/dashboard',label:'Dashboard',icon:LayoutDashboard},
    {href:'/tasks',label:'My Tasks',icon:ClipboardList},{href:'/engagements',label:'Audit Engagements',icon:FolderOpen},
  ]},
  {title:'OFFICE',items:[
    {href:'/messages',label:'Messages',icon:MessageSquare},{href:'/announcements',label:'Announcements',icon:Megaphone},
    {href:'/leave',label:'Leave',icon:Umbrella},{href:'/employees',label:'Employees',icon:UsersRound},
    {href:'/reports',label:'Reports',icon:FileChartColumn},
  ]},
  {title:'MANAGEMENT',items:[
    {href:'/administration',label:'Administration',icon:Shield,require:'calendar:manage'},
  ]},
]
const pageNames:Record<string,string>={ '/calendar':'Calendar','/notifications':'Notifications','/settings':'Settings',
  ...Object.fromEntries(nav.flatMap(group=>group.items.map(item=>[item.href,item.label]))) }

export default function App() {
  const [session,setSession]=useState<Session|null|undefined>(undefined)
  const cache=useQueryClient()
  const previous=useRef<string|null>(null)
  useEffect(()=>{
    const {data:{subscription}}=db.auth.onAuthStateChange((_event,value)=>{
      const id=value?.user.id || null
      if (previous.current!==id) {
        cache.clear()
        previous.current=id
      }
      setSession(value)
    })
    return ()=>subscription.unsubscribe()
  },[cache])
  const profile=useQuery({queryKey:['profile',session?.user.id],enabled:!!session,refetchInterval:20000,refetchIntervalInBackground:true,
    queryFn:()=>unwrap<Profile|null>(db.from('profiles').select('*').eq('id',session!.user.id).maybeSingle())})
  useEffect(()=>{
    if (session && profile.isSuccess && profile.data===null) void db.auth.signOut({scope:'local'})
  },[session,profile.isSuccess,profile.data])
  if (session===undefined || session && profile.isPending) return <main className="screen-loading"><Brand/><Busy/></main>
  if (!session) return <CalendarHome/>
  if (!profile.data) return <main className="screen-loading"><Brand/><ErrorText issue={profile.error}/><Button onClick={()=>void db.auth.signOut({scope:'local'})}>Return to sign-in</Button></main>
  const user=profile.data
  if (user.must_change_password) return <AuthLayout><div className="auth-icon"><LockKeyhole size={22}/></div><h1>Set your password</h1>
    <p>Change your temporary password to access the CIAS workspace.</p><Suspense fallback={<Busy/>}><PasswordForm/></Suspense>
    <Button variant="ghost" className="auth-back" onClick={()=>void db.auth.signOut({scope:'local'})}>Back to sign-in</Button>
  </AuthLayout>
  return <Shell user={user}><Suspense fallback={<Busy/>}><Routes>
    <Route index element={<Calendar user={user}/>}/><Route path="/calendar" element={<Navigate to="/" replace/>}/>
    <Route path="/dashboard" element={<Dashboard user={user}/>}/>
    <Route path="/tasks" element={<Tasks user={user}/>}/><Route path="/engagements" element={<Engagements user={user}/>}/>
    <Route path="/engagements/:id" element={<Workspace user={user}/>}/><Route path="/messages" element={<Messages user={user}/>}/>
    <Route path="/announcements" element={<Announcements user={user}/>}/><Route path="/leave" element={<Leave user={user}/>}/>
    <Route path="/employees" element={<Employees user={user}/>}/><Route path="/notifications" element={<Notifications/>}/>
    <Route path="/reports" element={<Reports user={user}/>}/>
    <Route path="/administration" element={can(user,'calendar:manage') ? <Administration user={user}/> : <Navigate to="/" replace/>}/>
    <Route path="/settings" element={<Settings user={user}/>}/><Route path="*" element={<Navigate to="/" replace/>}/>
  </Routes></Suspense></Shell>
}
function AuthLayout({children}:{children:ReactNode}) {
  return <main className="auth-layout">
    <section className="auth-story">
      <Brand/>
      <div className="auth-art" aria-hidden="true"><i/><i/><i/><i/><b/><b/><b/></div>
      <div className="auth-intro"><span><i/> CITY GOVERNMENT OF CAGAYAN DE ORO</span>
        <h2>City Internal<br/>Audit Services.</h2><p>Office coordination for the CIAS team.</p></div>
      <footer><Shield size={15}/> Private staff workspace</footer>
    </section>
    <section className="auth-main"><div className="mobile-brand"><Brand/></div><div className="auth-content">{children}</div>
      <footer>City Internal Audit Services · Cagayan de Oro</footer></section>
  </main>
}
function CalendarHome() {
  return <div className="calendar-home">
    <header className="calendar-home-header">
      <div className="calendar-home-frame">
        <Link to="/" aria-label="CIAS home"><Brand/></Link>
        <span className="calendar-home-office">City Internal Audit Services</span>
        <a className="calendar-home-sign-in" href="#staff-sign-in"><LockKeyhole size={15}/> Staff sign-in</a>
      </div>
    </header>
    <main className="calendar-home-frame calendar-home-content">
      <div className="page-title calendar-home-heading"><h1>Calendar</h1></div>
      <div className="calendar-home-schedule">
        <Suspense fallback={<Busy/>}><SignedOutCalendar/></Suspense>
      </div>
      <aside className="card calendar-home-login" id="staff-sign-in" tabIndex={-1} aria-labelledby="staff-sign-in-title"><Login/></aside>
    </main>
  </div>
}

function Login() {
  const [show,setShow]=useState(false)
  const {register,handleSubmit,setError,formState:{errors,isSubmitting}}=useForm<z.infer<typeof identity>>({resolver:zodResolver(identity)})
  const submit=handleSubmit(async (fields)=>{
    try {
      const result=await account<{access_token:string;refresh_token:string}>({action:'login',...fields})
      const updated=await db.auth.setSession(result)
      if (updated.error) throw new Error('Your session could not be started.')
    } catch (error) { setError('root',{message:error instanceof Error ? error.message : 'Sign-in failed.'}) }
  })
  return <><div className="auth-icon"><LockKeyhole size={20}/></div>
    <h2 id="staff-sign-in-title">Sign in to CIAS</h2><p>Use your staff account to see the full office calendar and workspace.</p>
    <form className="stack" onSubmit={submit}>
      <Field label="Username"><input autoComplete="username" placeholder="Enter username" {...register('username')} aria-invalid={!!errors.username}/></Field>
      {errors.username && <p className="error" role="alert">{errors.username.message}</p>}
      <Field label="Password"><span className="password-input"><input type={show ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter password" {...register('password')} aria-invalid={!!errors.password}/>
        <Button size="icon" variant="ghost" aria-label={show ? 'Hide password' : 'Show password'} onClick={()=>setShow(!show)}>{show ? <EyeOff size={18}/> : <Eye size={18}/>}</Button></span></Field>
      {errors.password && <p className="error" role="alert">{errors.password.message}</p>}
      {errors.root && <p className="error" role="alert">{errors.root.message}</p>}
      {!configured && <p className="error" role="status">Connect the workspace to Supabase to enable sign-in.</p>}
      <Button type="submit" variant="primary" className="login-submit" disabled={isSubmitting || !configured}>{isSubmitting ? 'Signing in…' : 'Sign in'} <ArrowRight size={17}/></Button>
    </form>
    <p className="auth-help">Need help with access? Contact your CIAS administrator.</p>
  </>
}
function Shell({user,children}:{user:Profile;children:ReactNode}) {
  const path=useLocation().pathname
  const [drawer,setDrawer]=useState(false), [accountOpen,setAccountOpen]=useState(false)
  const drawerRef=useRef<HTMLDialogElement>(null)
  const shortcuts=useRef<HTMLDivElement>(null)
  const cache=useQueryClient()
  const alerts=useRows<Alert>('notifications','created_at',12)
  const count=alerts.data?.filter(item=>!item.read_at).length || 0
  useEffect(()=>{
    const element=drawerRef.current
    if (drawer && element && !element.open) element.showModal()
    if (!drawer && element?.open) element.close()
  },[drawer])
  useEffect(()=>{
    if (!accountOpen) return
    const close=(event:MouseEvent)=>{if(event.target instanceof Node && !shortcuts.current?.contains(event.target)) setAccountOpen(false)}
    const key=(event:KeyboardEvent)=>{if(event.key==='Escape') setAccountOpen(false)}
    document.addEventListener('click',close); document.addEventListener('keydown',key)
    return ()=>{document.removeEventListener('click',close);document.removeEventListener('keydown',key)}
  },[accountOpen])
  useEffect(()=>{
    const channel=db.channel('cias-notifications-'+user.id)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'notifications',filter:'recipient_id=eq.'+user.id},
        ()=>void cache.invalidateQueries({queryKey:['notifications']}))
      .subscribe()
    return ()=>{void db.removeChannel(channel)}
  },[cache,user.id])
  const section=path.startsWith('/engagements/') ? 'Audit Engagements' : pageNames[path] || 'Workspace'
  const links=(close?:()=>void)=><>
    <Link className="sidebar-brand" to="/" onClick={close}><Brand/></Link>
    <nav aria-label="Workspace navigation">{nav.map(group=>{
      const items=group.items.filter(item=>!('require' in item) || typeof item.require==='string' && can(user,item.require))
      return items.length ? <div className="nav-group" key={group.title}><p>{group.title}</p>{items.map(({href,label,icon:Icon})=><NavLink key={href} to={href} end={href==='/'} onClick={close}><Icon size={18}/>{label}</NavLink>)}</div> : null
    })}</nav>
    <div className="sidebar-foot">
      <NavLink to="/settings" onClick={close}><SettingsIcon size={18}/> Settings</NavLink>
      <div className="sidebar-person"><Avatar name={user.full_name}/><div><strong>{user.full_name}</strong><small>{user.designation}</small></div></div>
    </div>
  </>
  return <div className="app-shell">
    <a className="skip-link" href="#workspace-content">Skip to workspace</a>
    <aside className="sidebar">{links()}</aside>
    <dialog ref={drawerRef} className="mobile-drawer sidebar" aria-label="Workspace navigation"
      onCancel={()=>setDrawer(false)} onClick={e=>{if(e.target===e.currentTarget)setDrawer(false)}}>
      <Button size="icon" variant="ghost" className="close-drawer" aria-label="Close navigation" onClick={()=>setDrawer(false)}><X size={21}/></Button>{links(()=>setDrawer(false))}
    </dialog>
    <div className="workspace">
      <header className="topbar">
        <div className="breadcrumb"><Button className="drawer-button" size="icon" variant="ghost" aria-label="Open navigation" onClick={()=>setDrawer(true)}><Menu size={23}/></Button>
          <span>Workspace</span><i>/</i><strong>{section}</strong></div>
        <div className="topbar-actions">
          <span className="topbar-clock"><span/>{now().toFormat('MMM d, yyyy')} · PHT</span>
          <Button asChild size="icon" variant="ghost" className="notification-link"><Link to="/notifications" aria-label={count ? 'Notifications, '+count+' unread' : 'Notifications'}><Bell size={19}/>{count>0 && <i/>}</Link></Button>
          <div className="account-shortcuts" ref={shortcuts}>
            <button type="button" className="account-toggle" aria-label="Account menu" aria-expanded={accountOpen} onClick={()=>setAccountOpen(!accountOpen)}><Avatar name={user.full_name}/><ChevronDown size={15}/></button>
            {accountOpen && <div className="account-menu"><strong>{user.full_name}</strong><small>@{user.username}</small>
              <Link to="/settings" onClick={()=>setAccountOpen(false)}><SettingsIcon size={16}/> Settings</Link>
              <button type="button" onClick={()=>void db.auth.signOut({scope:'local'})}><LogOut size={16}/> Sign out</button></div>}
          </div>
        </div>
      </header>
      <main id="workspace-content" className="content">{children}</main>
    </div>
  </div>
}

