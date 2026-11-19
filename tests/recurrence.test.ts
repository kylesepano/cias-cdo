import { describe, expect, it } from 'vitest'
import { DateTime } from 'luxon'
import { birthdayEvents, buildRule, expandEvents, type EventRow } from '../src/recurrence'

const base: EventRow = {
  id:'series',title:'Calendar series',description:'',location:'',meeting_url:null,category_id:'activity',
  starts_at:'2026-01-02T16:00:00+08:00',ends_at:null,all_day:false,timezone:'Asia/Manila',
  rrule:'FREQ=WEEKLY;BYDAY=FR',visibility:'office',engagement_id:null,owner_id:null,managed_leave:false,
}
const format = (iso:string) => DateTime.fromISO(iso,{zone:'Asia/Manila'}).toFormat('yyyy-MM-dd HH:mm')
const date = (ymd:string) => ymd+'T00:00:00+08:00'
describe('Manila calendar recurrence',()=>{
  it('keeps Friday times over New Year and preserves missing end times',()=>{
    const events=expandEvents([base,{...base,id:'flag',starts_at:'2026-01-02T16:50:00+08:00'}],[],
      date('2026-12-25'),date('2027-01-03'))
    expect(events.map(event=>format(event.start))).toEqual(['2026-12-25 16:00','2026-12-25 16:50','2027-01-01 16:00','2027-01-01 16:50'])
    expect(events.every(event=>event.end===null)).toBe(true)
  })
  it('uses the last Friday in consecutive 4-Friday and 5-Friday months',()=>{
    const cleanup={...base,starts_at:'2026-01-30T06:00:00+08:00',ends_at:'2026-01-30T08:00:00+08:00',
      rrule:'FREQ=MONTHLY;BYDAY=FR;BYSETPOS=-1'}
    const rows=expandEvents([cleanup],[],date('2026-04-01'),date('2026-07-01'))
    expect(rows.map(row=>format(row.start))).toEqual(['2026-04-24 06:00','2026-05-29 06:00','2026-06-26 06:00'])
    expect(rows.map(row=>format(row.end!).slice(-5))).toEqual(['08:00','08:00','08:00'])
  })
  it('keeps the remaining dates when cancelling one date and moving another',()=>{
    const rows=expandEvents([base],[
      {event_id:'series',occurrence_at:'2026-11-06T16:00:00+08:00',cancelled:true,title:null,starts_at:null,ends_at:null},
      {event_id:'series',occurrence_at:'2026-10-30T16:00:00+08:00',cancelled:false,title:'Rescheduled',starts_at:'2026-11-09T09:00:00+08:00',ends_at:null},
      {event_id:'series',occurrence_at:'2026-11-13T16:00:00+08:00',cancelled:false,title:null,starts_at:'2026-12-01T09:00:00+08:00',ends_at:null},
    ],date('2026-11-01'),date('2026-11-22'))
    expect(rows.map(row=>format(row.start))).toEqual(['2026-11-09 09:00','2026-11-20 16:00'])
    expect(rows[0].title).toBe('Rescheduled')
  })
  it('skips nonexistent dates and clips to the visible window',()=>{
    const event={...base,starts_at:'2026-01-31T10:00:00+08:00',rrule:'FREQ=MONTHLY;BYMONTHDAY=31'}
    expect(expandEvents([event],[],date('2026-01-01'),date('2026-04-01')).map(row=>format(row.start)))
      .toEqual(['2026-01-31 10:00','2026-03-31 10:00'])
    expect(expandEvents([event],[],date('2026-01-01'),date('2026-05-01'))).toEqual([])
  })
  it('shows only opt-in birthdays, once annually, including leap day policy',()=>{
    const birthdays=birthdayEvents([{id:'private',full_name:'Private'},{id:'normal',full_name:'Shared',birth_month:3,birth_day:1},
      {id:'leap',full_name:'Leap',birth_month:2,birth_day:29}])
    expect(expandEvents(birthdays,[],date('2027-02-01'),date('2027-04-01')).map(row=>row.title)).toEqual(['Shared · Birthday'])
    expect(expandEvents(birthdays,[],date('2028-02-01'),date('2028-04-01')).map(row=>row.title)).toEqual(['Leap · Birthday','Shared · Birthday'])
  })
  it('supports intervals, selected weekdays, count and inclusive final dates',()=>{
    const values={starts:'2026-11-02T09:00',repeat:'daily',interval:'2',end_type:'count',occurrence_count:'3'}
    const event={...base,starts_at:'2026-11-02T09:00:00+08:00',rrule:buildRule(values,['MO','WE','FR'])}
    expect(expandEvents([event],[],date('2026-11-01'),date('2026-12-01')).map(row=>format(row.start)))
      .toEqual(['2026-11-02 09:00','2026-11-04 09:00','2026-11-06 09:00'])
    const series={...event,rrule:buildRule({...values,interval:'1',end_type:'date',until:'2026-11-04'},[])}
    expect(expandEvents([series],[],date('2026-11-01'),date('2026-11-05'))).toHaveLength(3)
  })
})

