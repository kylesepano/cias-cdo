import { createClient } from '@supabase/supabase-js'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DateTime } from 'luxon'
import Papa from 'papaparse'
import { useEffect, useState } from 'react'

export const ZONE = 'Asia/Manila'
export const now = () => DateTime.now().setZone(ZONE)
export const day = (value: string) => DateTime.fromISO(value, { zone: ZONE })
export const pretty = (value?: string | null) => value ? day(value).toFormat('MMM d, yyyy') : '—'
export const localInput = (value?: string | null, allDay = false) => value ? day(value).toFormat(allDay ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm") : ''
export const pickerValue = (date: string) => {
  const parsed = day(date)
  if (!parsed.isValid) throw new Error('Choose a valid date and time.')
  return parsed.toUTC().toISO()
}
export const initials = (name = '') => name.trim().split(/\s+/).filter(Boolean).filter((_,i,a) => i === 0 || i === a.length - 1).map(piece => piece[0]).join('').toUpperCase()
export const statusNames: Record<string, string> = {todo:'To do',in_progress:'In progress',submitted:'For review',completed:'Completed',needs_revision:'Needs revision',pending:'Pending',approved:'Approved',declined:'Declined'}
export const capabilities = ['calendar:manage','notices:manage','reports:view','directory:edit','task:create','task:review','engagement:create','leave:approve']
export const configured = Boolean(import.meta.env.VITE_SUPABASE_URL && (import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY))
export const db = createClient(import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:56321',
  import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'setup-required')
export interface Profile {
  id: string; username: string; full_name: string; designation: string; system_role: string; admin_slot: number | null
  capabilities: string[]; active: boolean; must_change_password: boolean
  birth_month?: number; birth_day?: number; birthday_visible?: boolean
}
export interface Person { id: string; full_name: string; designation: string; birth_month?: number; birth_day?: number }
export interface Task {
  id: string; title: string; description: string; engagement_id: string | null; parent_id: string | null
  reviewer_id: string; priority: string; status: string; starts_on: string | null; due_on: string | null
  submitted_by: string | null; reviewed_by: string | null; work_completed_on: string | null; created_at: string
}
export interface Engagement {
  id: string; title: string; audited_office: string; code: string; lead_id: string; creator_id: string
  planned_start: string | null; planned_end: string | null; description: string; created_at: string
}
export interface Notice { id: string; title: string; body: string; acknowledgement_required: boolean; author_id: string; created_at: string }
export interface Alert { id: string; title: string; href: string; read_at: string | null; created_at: string }
export interface Leave { id: string; requester_id: string; starts_on: string; ends_on: string; reason: string; status: string; created_at: string }

export function can(user: Profile, name: string) {
  return user.system_role === 'superadmin' || user.capabilities.includes(name) ||
    (user.system_role === 'admin' && ['calendar:manage','notices:manage','reports:view','directory:edit'].includes(name))
}

type Result<T> = { data: T | null; error: { message: string } | null }
export async function unwrap<T>(request: PromiseLike<Result<T>>): Promise<T> {
  const { data, error } = await request
  if (error) throw new Error(error.message)
  return data as T
}
export const rpc = <T = unknown>(name: string, args?: Record<string, unknown>) => unwrap<T>(db.rpc(name,args))
export async function account<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const result = await db.functions.invoke('accounts', {body})
  if (result.error) {
    const context: unknown = result.error.context
    const details = context instanceof Response ? await context.json().catch(() => null) : null
    throw new Error(details?.error || 'The account service is unavailable.')
  }
  return result.data
}
export const useDirectory = () => useQuery({queryKey:['directory'],queryFn:() => rpc<Person[]>('directory')})
export const useRows = <T,>(name: string, order = 'created_at', limit = 200) => useQuery({
  queryKey:[name,order,limit], queryFn:() => unwrap<T[]>(db.from(name).select('*').order(order,{ascending:false}).limit(limit)),
})
export function useAction<T = void>(run: (input: T) => Promise<unknown>, keys: string[], done?: () => void) {
  const cache = useQueryClient()
  return useMutation({
    mutationFn: run,
    onSuccess: async () => {
      await Promise.all(keys.map(key => cache.invalidateQueries({queryKey:[key]})))
      done?.()
    },
  })
}
export const failure = (issue: unknown) => issue instanceof Error ? issue.message : ''
export function values(form: HTMLFormElement) { return Object.fromEntries(new FormData(form)) as Record<string,string> }
export function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  const url = URL.createObjectURL(new Blob([Papa.unparse(rows,{escapeFormulae:true})],{type:'text/csv;charset=utf-8'}))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url),1000)
}
export function useMedia(query: string) {
  const [result,setResult] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const onChange = () => setResult(media.matches)
    onChange()
    media.addEventListener('change',onChange)
    return () => media.removeEventListener('change',onChange)
  },[query])
  return result
}

