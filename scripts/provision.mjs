import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CIAS_TEMP_PASSWORD, CIAS_ROSTER_FILE } = process.env
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !CIAS_ROSTER_FILE || !CIAS_TEMP_PASSWORD || CIAS_TEMP_PASSWORD.length < 8) {
  throw new Error('Provide the Supabase URL, server key, roster file and a temporary password of at least 8 characters.')
}
const remote = !['127.0.0.1','localhost','[::1]'].includes(new URL(SUPABASE_URL).hostname)
const skipInitialChange = process.env.CIAS_SKIP_INITIAL_PASSWORD_CHANGE === '1'
if (remote && skipInitialChange) {
  throw new Error('Skipping the initial password change is available only on a local Supabase instance.')
}
if (remote && (process.env.CIAS_ALLOW_REMOTE !== 'approved' || CIAS_TEMP_PASSWORD.length < 12)) {
  throw new Error('Hosted provisioning requires an approved target and temporary passwords of at least 12 characters.')
}
const roster = JSON.parse(await readFile(CIAS_ROSTER_FILE,'utf8'))
const defaults = ['calendar:manage','notices:manage','reports:view','directory:edit','leave:approve']
const auditors = ['task:create','task:review','engagement:create']
const access = {
  superadmin: { system_role:'superadmin' },
  head: { capabilities:[...auditors,'leave:approve','reports:view'] },
  supervisor: { system_role:'admin',admin_slot:1,capabilities:['leave:approve'] },
  admin: { system_role:'admin',admin_slot:2,capabilities:['leave:approve'] },
  office_admin: { capabilities:defaults.filter(capability => capability !== 'leave:approve') },
  lead: { capabilities:auditors },
  auditor: {},
}
if (!Array.isArray(roster) || roster.filter(person => person.access === 'superadmin').length !== 1 ||
    roster.some(person => !/^[a-z0-9][a-z0-9._-]{0,31}$/.test(person.username) || !person.full_name?.trim() || !Object.hasOwn(access,person.access)) ||
    new Set(roster.map(person => person.username)).size !== roster.length) {
  throw new Error('The roster requires unique lowercase usernames, names and access mappings, including exactly one superadmin.')
}
if (remote && (roster.some(person => typeof person.password_env !== 'string') ||
    new Set(roster.map(person => process.env[person.password_env])).size !== roster.length ||
    roster.some(person => (process.env[person.password_env] || '').length < 12))) {
  throw new Error('Hosted users require distinct temporary passwords from individual environment variables.')
}
const client = createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{ auth:{ autoRefreshToken:false,persistSession:false } })
const { data: existing, error: lookupError } = await client.from('profiles').select('username,system_role').eq('system_role','superadmin').eq('active',true).maybeSingle()
if (lookupError) throw new Error('Unable to verify the target database.')
if (existing && existing.username !== roster.find(person => person.access === 'superadmin').username) throw new Error('A different superadmin is already active.')
for (const person of [...roster].sort((a,b) => Number(b.access === 'superadmin') - Number(a.access === 'superadmin'))) {
  const found = await client.from('profiles').select('id').eq('username',person.username).maybeSingle()
  if (found.error) throw new Error('Profile lookup failed.')
  if (found.data) {
    console.log('Already provisioned:',person.username)
    continue
  }
  const create = await client.auth.admin.createUser({
    email:person.username+'@identity.cias.invalid',password:process.env[person.password_env] || CIAS_TEMP_PASSWORD,email_confirm:true
  })
  if (create.error) throw new Error('Supabase Auth provisioning failed for '+person.username+': '+create.error.message)
  const userId = create.data.user.id
  const insert = await client.from('profiles').insert({
    id:userId,username:person.username,full_name:person.full_name.trim(),designation:person.designation,...access[person.access]
  })
  if (insert.error) {
    await client.auth.admin.deleteUser(userId)
    throw new Error('Profile provisioning failed for '+person.username+': '+insert.error.message)
  }
  console.log('Provisioned:',person.username)
}

if (skipInitialChange) {
  const { error } = await client.from('profiles').update({must_change_password:false})
    .in('username',roster.map(person=>person.username))
  if (error) throw new Error('Unable to remove the initial password-change requirement for the local roster.')
  console.log('First-login password change disabled for the local roster.')
}

