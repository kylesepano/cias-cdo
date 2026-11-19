import { z } from 'zod'
import { day,now,type Profile } from './data'

export type ReportPeriod = {from_date:string;to_date:string}
export type ApprovedTask = {task_title:string;engagement_code:string|null;approved_on:string;approval_note:string|null;completed_on:string}
export type Annex = 'A'|'B'

const short=z.string().max(160)
const narrative=z.string().max(6000)
const dateInput=z.union([z.literal(''),z.iso.date()])
const task=z.object({task:narrative,target:short,actual:short,remarks:narrative})
const activity=z.object({date:dateInput,activity:narrative})
export const draftSchema=z.object({
  employee:short,position:short,division:short,preparedOn:dateInput,reviewer:short,reviewerPosition:short,
  completed:short,ongoing:short,summary:narrative,issues:narrative,plans:narrative,
  tasks:z.array(task).max(150),activities:z.array(activity).max(365),
})
export type AccomplishmentDraft = z.infer<typeof draftSchema>
export type SavedAccomplishment = {period_start:string;period_end:string;revision:number;updated_at:string;content:unknown}
export const emptyTask=():AccomplishmentDraft['tasks'][number]=>({task:'',target:'',actual:'',remarks:''})
export const emptyActivity=():AccomplishmentDraft['activities'][number]=>({date:'',activity:''})

export function startingDraft(user: Profile, approved: ApprovedTask[]): AccomplishmentDraft {
  const tasks=approved.slice(0,150).map(row=>({...emptyTask(),task:row.task_title,actual:'1',remarks:'Completed'}))
  const activities=approved.slice().reverse().slice(0,365).map(row=>({date:row.completed_on,activity:row.task_title}))
  return {
    employee:user.full_name,position:user.designation,division:'',preparedOn:now().toISODate()!,
    reviewer:'',reviewerPosition:'',completed:String(tasks.length),ongoing:'',summary:'',issues:'',plans:'',
    tasks,activities,
  }
}

export function periodLabel(period:ReportPeriod) {
  const start=day(period.from_date), end=day(period.to_date)
  if (start.hasSame(end,'day')) return start.toFormat('MMMM d, yyyy')
  if (start.hasSame(end,'month')) return start.toFormat('MMMM d')+'–'+end.toFormat('d, yyyy')
  return start.toFormat('MMMM d, yyyy')+' – '+end.toFormat('MMMM d, yyyy')
}
