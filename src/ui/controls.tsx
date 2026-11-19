import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { X, Inbox, LoaderCircle } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { failure, initials, statusNames, type Person } from '../data'

export const cn = (...input: ClassValue[]) => twMerge(clsx(input))
const button = cva('button', {variants:{variant:{primary:'primary',outline:'outline',ghost:'ghost',danger:'danger'},size:{default:'',small:'button-sm',icon:'icon-button'}},defaultVariants:{variant:'outline',size:'default'}})
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button> & {asChild?:boolean}
export function Button({className,variant,size,asChild,type = 'button',...props}:ButtonProps) {
  const Root = asChild ? Slot : 'button'
  return <Root {...props} type={asChild ? undefined : type} className={cn(button({variant,size}),className)} />
}
export function Brand() {
  return <div className="brand"><div className="brand-mark"><span /><span /><span /></div><div><strong>CIAS</strong><small>OFFICE WORKSPACE</small></div></div>
}
export function Avatar({name,large=false}:{name:string;large?:boolean}) {
  return <span aria-hidden="true" className={cn('avatar',large && 'avatar-large')}>{initials(name)}</span>
}
export function PageTitle({title,description,children}:{title:string;description?:string;children?:ReactNode}) {
  return <div className="page-title"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{children && <div className="actions">{children}</div>}</div>
}
export function Card({title,description,action,children,className}:{title?:string;description?:string;action?:ReactNode;children:ReactNode;className?:string}) {
  return <section className={cn('card',className)}>{title && <div className="card-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>}{children}</section>
}
export function Empty({title='Nothing to show yet',detail}:{title?:string;detail?:string}) {
  return <div className="empty"><span><Inbox size={20} /></span><strong>{title}</strong>{detail && <p>{detail}</p>}</div>
}
export function ErrorText({issue}:{issue:unknown}) {
  const text = failure(issue)
  return text ? <p className="error" role="alert">{text}</p> : null
}
export function Busy() { return <div className="loading" role="status"><LoaderCircle size={18} className="animate-spin" /> Loading…</div> }
export function Field({label,children,wide=false}:{label:string;children:ReactNode;wide?:boolean}) {
  return <label className={cn('field',wide && 'wide')}><span>{label}</span>{children}</label>
}
export function Status({status}:{status:string}) {
  return <span className={cn('badge',status)}>{statusNames[status] || status}</span>
}
export function Dialog({title,children,close}:{title:string;children:ReactNode;close:() => void}) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => { const element = ref.current; element?.showModal(); return () => element?.close() },[])
  return <dialog ref={ref} className="dialog" aria-labelledby={id} onCancel={close}
    onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="dialog-inner"><div className="dialog-head"><h2 id={id}>{title}</h2><Button size="icon" variant="ghost" aria-label="Close" onClick={close}><X size={19} /></Button></div>{children}</div>
  </dialog>
}
export function StaffPicker({people,selected,setSelected,label='Personnel'}:{people:Person[];selected:string[];setSelected:(next:string[])=>void;label?:string}) {
  const [search,setSearch] = useState('')
  return <fieldset className="staff-picker wide"><legend>{label}</legend>
    <input aria-label={'Search '+label.toLowerCase()} placeholder="Search names" value={search} onChange={e => setSearch(e.target.value)} />
    <div>{people.filter(person => person.full_name.toLowerCase().includes(search.toLowerCase())).map(person =>
      <label key={person.id}><input type="checkbox" checked={selected.includes(person.id)}
        onChange={e => setSelected(e.target.checked ? [...selected,person.id] : selected.filter(id => id !== person.id))} />{person.full_name}</label>
    )}</div></fieldset>
}

