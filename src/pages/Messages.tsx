import { useInfiniteQuery,useQuery,useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, ChevronUp, Plus, Search, Send, UsersRound } from 'lucide-react'
import { useEffect,useRef,useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { day,db,rpc,unwrap,useAction,useDirectory,useRows,type Person,type Profile } from '../data'
import { Avatar,Busy,Button,Card,Dialog,Empty,ErrorText,Field,PageTitle,StaffPicker } from '../ui/controls'

type Chat={id:string;title:string|null;creator_id:string;direct_key:string|null;created_at:string}
type Member={conversation_id:string;user_id:string;last_read_id:number;is_manager:boolean}
type Message={id:number;conversation_id:string;author_id:string;body:string;created_at:string}
const keys=['conversations','conversation_members','conversation_unread']
const pageSize=35
export default function Messages({user}:{user:Profile}) {
  const [params,setParams]=useSearchParams()
  const active=params.get('chat')
  const target=params.get('person')
  const [filter,setFilter]=useState(''), [editing,setEditing]=useState<'new'|'edit'|null>(null)
  const chats=useRows<Chat>('conversations'), people=useDirectory()
  const members=useQuery({queryKey:['conversation_members'],queryFn:()=>unwrap<Member[]>(db.from('conversation_members').select('*')),refetchInterval:15000})
  const unread=useQuery({queryKey:['conversation_unread'],queryFn:()=>rpc<{conversation_id:string;unread:number}[]>('conversation_unread'),refetchInterval:15000})
  const cache=useQueryClient()
  useEffect(()=>{
    const channel=db.channel('cias-inbox-'+user.id)
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},event=>{
        const item=event.new as Message
        void cache.invalidateQueries({queryKey:['messages',item.conversation_id]})
        void cache.invalidateQueries({queryKey:['conversation_unread']})
      }).on('postgres_changes',{event:'UPDATE',schema:'public',table:'conversation_members'},()=>void cache.invalidateQueries({queryKey:['conversation_members']}))
      .subscribe()
    return ()=>{void db.removeChannel(channel)}
  },[cache,user.id])
  const existing=chats.data?.find(row=>row.id===active)
  const names=(id:string)=>people.data?.find(person=>person.id===id)?.full_name || 'Former employee'
  const title=(row:Chat)=>row.title || names(members.data?.find(member=>member.conversation_id===row.id && member.user_id!==user.id)?.user_id || '')
  const visible=chats.data?.filter(row=>title(row).toLowerCase().includes(filter.toLowerCase()) ||
    members.data?.some(m=>m.conversation_id===row.id && m.user_id!==user.id && names(m.user_id).toLowerCase().includes(filter.toLowerCase()))) || []
  const select=(id:string)=>setParams({chat:id})
  return <><PageTitle title="Messages" description="Direct messages and private team conversations.">
    <Button variant="primary" onClick={()=>setEditing('new')}><Plus size={17}/> New conversation</Button>
  </PageTitle><ErrorText issue={chats.error || members.error || people.error || unread.error}/>
  <Card className={'messages-layout'+(existing ? ' chat-open' : '')}>
    <aside className="chat-list"><div className="chat-search"><label className="search"><Search size={16}/><input aria-label="Search conversations" placeholder="Search conversations" value={filter} onChange={e=>setFilter(e.target.value)}/></label></div>
      {chats.isPending ? <Busy/> : visible.length ? visible.map(row=>{
        const count=unread.data?.find(item=>item.conversation_id===row.id)?.unread || 0
        return <button type="button" className={'chat-link'+(active===row.id ? ' selected' : '')} key={row.id} onClick={()=>select(row.id)} aria-pressed={active===row.id}>
          {row.title ? <span className="stat-icon mint"><UsersRound size={17}/></span> : <Avatar name={title(row)}/>}
          <span><strong>{title(row)}</strong><small>{row.title ? 'Private group' : 'Direct message'}</small></span>
          {!!count && <span className="unread-count" aria-label={count+' unread'}>{count}</span>}
        </button>
      }) : <Empty title="No conversations"/>}
    </aside>
    <section className="chat-area" aria-label="Conversation">
      {existing ? <Conversation key={existing.id} chat={existing} title={title(existing)} user={user}
        members={members.data?.filter(m=>m.conversation_id===existing.id) || []} people={people.data || []}
        back={()=>setParams({})} edit={()=>setEditing('edit')}/> : <Empty title={active && !chats.isPending ? 'Conversation unavailable' : 'Select a conversation'}
        detail="Choose a conversation or start a new one with a colleague."/>}
    </section>
  </Card>
  {(editing || target) && <ChatEditor chat={editing==='edit' ? existing : undefined} user={user}
    initial={editing==='edit' ? members.data?.filter(m=>m.conversation_id===existing?.id && m.user_id!==user.id).map(m=>m.user_id) : target ? [target] : []}
    people={(people.data || []).filter(p=>p.id!==user.id)} close={()=>{setEditing(null);if(target)setParams({})}}
    done={id=>{setEditing(null);select(id)}}/>}</>
}
function Conversation({chat,title,user,members,people,edit,back}:{chat:Chat;title:string;user:Profile;members:Member[];people:Person[];edit:()=>void;back:()=>void}) {
  const history=useInfiniteQuery({queryKey:['messages',chat.id],initialPageParam:null as number|null,
    queryFn:({pageParam})=>{
      let query=db.from('messages').select('*').eq('conversation_id',chat.id).order('id',{ascending:false}).limit(pageSize)
      if (pageParam!==null) query=query.lt('id',pageParam)
      return unwrap<Message[]>(query)
    },
    getNextPageParam:last=>last.length===pageSize ? last[last.length-1].id : undefined,refetchInterval:15000,
  })
  const [body,setBody]=useState('')
  const bottom=useRef<HTMLDivElement>(null)
  const newest=history.data?.pages[0]?.[0]?.id
  const cache=useQueryClient()
  const lastRead=members.find(member=>member.user_id===user.id)?.last_read_id || 0
  useEffect(()=>{
    if (!newest) return
    bottom.current?.scrollIntoView({block:'nearest'})
  },[newest])
  useEffect(()=>{
    if (!newest || newest<=lastRead) return
    let alive=true
    const mark=()=>{if(document.visibilityState==='visible') void rpc('mark_conversation',{target:chat.id,through_id:newest})
      .then(async ()=>{if(alive) await Promise.all(keys.map(key=>cache.invalidateQueries({queryKey:[key]})))}).catch(()=>{})}
    mark()
    document.addEventListener('visibilitychange',mark)
    return ()=>{alive=false;document.removeEventListener('visibilitychange',mark)}
  },[cache,chat.id,lastRead,newest])
  const send=useAction(()=>rpc('send_message',{target:chat.id,message_body:body}),['messages','conversation_unread'],()=>setBody(''))
  const messages=(history.data?.pages.flat() || []).slice().reverse()
  return <><div className="chat-head">
    <Button className="chat-back" size="icon" aria-label="Back to conversations" onClick={back}><ArrowLeft size={17}/></Button>
    {chat.title ? <span className="stat-icon mint"><UsersRound size={18}/></span> : <Avatar name={title}/>}
    <div><h2>{title}</h2><small>{chat.title ? members.length+' members' : 'Direct message'}</small></div>
    {chat.title && members.some(m=>m.user_id===user.id && m.is_manager) && <Button size="small" onClick={edit}>Manage group</Button>}
  </div><div className="chat-history">
    {history.hasNextPage && <div className="actions justify-center"><Button size="small" onClick={()=>void history.fetchNextPage()} disabled={history.isFetchingNextPage}><ChevronUp size={16}/> Older messages</Button></div>}
    <ErrorText issue={history.error}/>
    {history.isPending ? <Busy/> : !messages.length ? <Empty title="Start the conversation"/> : messages.map(item=>{
      const own=item.author_id===user.id
      const read=own && members.some(m=>m.user_id!==user.id && m.last_read_id>=item.id)
      return <div className={'chat-message'+(own ? ' own' : '')} key={item.id}>
        {!own && chat.title && <strong>{people.find(p=>p.id===item.author_id)?.full_name || 'Former employee'}</strong>}
        <p className="preserve">{item.body}</p>
        <small>{day(item.created_at).toFormat('MMM d · h:mm a')}{read && <span title="Read"><Check size={13}/> Read</span>}</small>
      </div>
    })}
    <div ref={bottom}/>
  </div><form className="chat-compose" onSubmit={e=>{e.preventDefault();send.mutate()}}>
    <input aria-label="Message" value={body} onChange={e=>setBody(e.target.value)} placeholder="Write a message…" maxLength={8000} required/>
    <Button aria-label="Send message" type="submit" variant="primary" disabled={send.isPending || !body.trim()}><Send size={17}/></Button>
    <ErrorText issue={send.error}/>
  </form></>
}
function ChatEditor({chat,user,people,initial,close,done}:{chat?:Chat;user:Profile;people:Person[];initial?:string[];close:()=>void;done:(id:string)=>void}) {
  const [group,setGroup]=useState(!!chat), [selected,setSelected]=useState(initial || []), [name,setName]=useState(chat?.title || '')
  const cache=useQueryClient()
  const save=useAction(async ()=>{
    const id=await rpc<string>('save_conversation',{target:chat?.id || null,group_name:group ? name : null,members:selected})
    await Promise.all(keys.map(key=>cache.invalidateQueries({queryKey:[key]})))
    done(id)
  },[])
  return <Dialog title={chat ? 'Manage private group' : 'New conversation'} close={close}>
    <form className="form-grid" onSubmit={e=>{e.preventDefault();save.mutate()}}>
      {!chat && <Field label="Type" wide><select value={group ? 'group' : 'direct'} onChange={e=>{setGroup(e.target.value==='group');setSelected([])}}>
        <option value="direct">Direct message</option><option value="group">Private group</option></select></Field>}
      {group ? <><Field label="Group name" wide><input value={name} onChange={e=>setName(e.target.value)} maxLength={120} required/></Field>
        <StaffPicker label="Group members" people={people} selected={selected} setSelected={setSelected}/></> :
        <Field label="Colleague" wide><select value={selected[0] || ''} onChange={e=>setSelected([e.target.value])} required>
          <option value="" disabled>Choose a colleague</option>{people.filter(person=>person.id!==user.id).map(person=><option value={person.id} key={person.id}>{person.full_name}</option>)}</select></Field>}
      <ErrorText issue={save.error}/><div className="dialog-actions wide"><Button variant="primary" type="submit" disabled={save.isPending || !group && selected.length!==1}>{chat ? 'Save group' : group ? 'Create group' : 'Open conversation'}</Button></div>
    </form>
  </Dialog>
}

