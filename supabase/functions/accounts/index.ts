import { createClient } from 'npm:@supabase/supabase-js@2.105.4'

const url = Deno.env.get('SUPABASE_URL')!
const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const publishable = Deno.env.get('SUPABASE_ANON_KEY')!
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, secret, options)
const authClient = () => createClient(url, publishable, options)
const emailFor = (username: string) => username + '@identity.cias.invalid'
const roles = ['admin', 'employee']
const grants = ['calendar:manage','notices:manage','reports:view','directory:edit','task:create','task:review','engagement:create','leave:approve']
const usernamePattern = /^[a-z0-9][a-z0-9._-]{0,31}$/
const occupiedIdentity = new Set(['email_exists','user_already_exists','identity_already_exists'])
const strong = (password: unknown): password is string => typeof password === 'string' &&
  password.length >= 12 && password.length <= 72 && /[a-z]/i.test(password) && /[0-9]/.test(password)
const cleanName = (value: unknown) => typeof value === 'string' ? value.trim().replace(/\s+/g,' ') : ''
const surnameUsername = (surname: string) => surname.normalize('NFKD').replace(/\p{Mark}/gu,'').toLowerCase()
  .replace(/['’]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,32).replace(/-$/,'')
const initialPassword = Deno.env.get('CIAS_NEW_ACCOUNT_PASSWORD')
const localTestAccounts = new URL(url).hostname === 'kong' && !Deno.env.get('SB_REGION') &&
  Deno.env.get('CIAS_SKIP_NEW_ACCOUNT_PASSWORD_CHANGE') === '1'

Deno.serve(async (request) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  }
  const respond = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers })
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  if (request.method !== 'POST') return respond(405, { error: 'Use POST.' })
  try {
    const raw = await request.text()
    if (raw.length > 8192) return respond(413, { error: 'Request is too large.' })
    const body = JSON.parse(raw)
    if (body.action === 'login') {
      const failed = () => respond(401, { error: 'Unable to sign in with those credentials.' })
      const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
      if (!usernamePattern.test(username) || typeof body.password !== 'string' || body.password.length > 128) return failed()
      const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(username))))
        .map((byte) => byte.toString(16).padStart(2,'0')).join('')
      const limit = await admin.rpc('account_attempt', { throttle_key: fingerprint })
      if (limit.error) return respond(503, { error: 'Sign-in is temporarily unavailable.' })
      if (!limit.data) return failed()
      const client = authClient()
      const { data, error } = await client.auth.signInWithPassword({ email: emailFor(username), password: body.password })
      if (error || !data.session) return failed()
      const profile = await admin.from('profiles').select('id').eq('id', data.user.id).eq('active', true).maybeSingle()
      if (!profile.data) {
        await client.auth.signOut({ scope: 'local' })
        return failed()
      }
      return respond(200, { access_token: data.session.access_token, refresh_token: data.session.refresh_token })
    }

    const token = request.headers.get('Authorization')?.match(/^Bearer (.+)$/i)?.[1]
    if (!token) return respond(401, { error: 'Sign in to continue.' })
    const { data: verified, error: authError } = await admin.auth.getUser(token)
    if (authError || !verified.user) return respond(401, { error: 'Your session has expired.' })
    const sessionClient = createClient(url, publishable, { ...options, global: { headers: { Authorization: 'Bearer ' + token } } })
    const profile = await sessionClient.from('profiles').select('*').eq('id', verified.user.id).maybeSingle()
    const actor = profile.data
    if (!actor) return respond(403, { error: 'Your account is unavailable.' })

    if (body.action === 'password') {
      if (!strong(body.password) || typeof body.current !== 'string' || body.current === body.password)
        return respond(400, { error: 'Use a different password with at least 12 characters, including a letter and a number.' })
      const client = authClient()
      const check = await client.auth.signInWithPassword({ email: emailFor(actor.username), password: body.current })
      if (check.error) return respond(400, { error: 'The current password is incorrect.' })
      const update = await admin.auth.admin.updateUserById(actor.id, { password: body.password })
      if (update.error) return respond(400, { error: 'The password could not be changed.' })
      const revoked = await admin.rpc('account_session_revoke', { target: actor.id })
      if (revoked.error) throw new Error('Unable to revoke sessions')
      const unlocked = await admin.from('profiles').update({ must_change_password: false }).eq('id', actor.id)
      if (unlocked.error) throw new Error('Unable to activate the new password')
      return respond(200, { ok: true })
    }

    if (actor.must_change_password) return respond(403, { error: 'Change your temporary password to continue.' })
    const superadmin = actor.system_role === 'superadmin'
    const directoryEditor = superadmin || actor.system_role === 'admin' || actor.capabilities.includes('directory:edit')
    if (body.action === 'list') {
      if (!superadmin) return respond(403, { error: 'Permission denied.' })
      const result = await admin.from('profiles').select('id,username,full_name,designation,system_role,admin_slot,capabilities,active,must_change_password').order('full_name')
      if (result.error) throw result.error
      return respond(200, { accounts: result.data })
    }
    if (body.action === 'rename' && directoryEditor) {
      const name = String(body.full_name || '').trim()
      if (!name || name.length > 120) return respond(400, { error: 'Enter a valid name.' })
      let query = admin.from('profiles').update({ full_name: name }).eq('id',body.id)
      if (!superadmin) query = query.eq('system_role','employee').eq('active',true)
      const result = await query.select('id').maybeSingle()
      if (!result.data || result.error) return respond(403, { error: 'This directory entry cannot be updated.' })
      const audit = await admin.from('activity_logs').insert({ actor_id: actor.id, entity: 'account', entity_id: body.id, action: 'directory name updated' })
      if (audit.error) throw audit.error
      return respond(200, { ok: true })
    }
    if (!superadmin) return respond(403, { error: 'Permission denied.' })
    let userId = body.id
    let result
    const config = () => ({
      designation: String(body.designation || 'Staff').trim().slice(0,100) || 'Staff',
      system_role: roles.includes(body.system_role) ? body.system_role : 'employee',
      admin_slot: body.system_role === 'admin' ? Number(body.admin_slot) : null,
      capabilities: Array.isArray(body.capabilities) ? [...new Set(body.capabilities.filter((cap: string) => grants.includes(cap)))] : [],
    })
    if (body.action === 'create') {
      const firstName = cleanName(body.first_name)
      const lastName = cleanName(body.last_name)
      const fullName = firstName+' '+lastName
      const base = surnameUsername(lastName)
      if (!firstName || !lastName || fullName.length>120 || !usernamePattern.test(base))
        return respond(400, { error: 'Enter a first and last name up to 120 characters combined. The last name must contain characters that can form a username.' })
      if (!initialPassword || initialPassword.length<8 || initialPassword.length>72)
        return respond(503, { error: 'Set the initial account password in the account service before adding staff.' })
      const access = config()
      for (let attempt=1;attempt<=100;attempt++) {
        const suffix = attempt===1 ? '' : String(attempt)
        const username = base.slice(0,32-suffix.length)+suffix
        const created = await admin.auth.admin.createUser({email:emailFor(username),password:initialPassword,email_confirm:true})
        if (created.error && occupiedIdentity.has(created.error.code || '')) continue
        if (created.error?.code==='weak_password')
          return respond(409, { error: 'The configured initial password does not meet this project’s password policy.' })
        if (!created.data.user) return respond(502, { error: 'The account service could not create the sign-in.' })
        const id = created.data.user.id
        const added = await admin.rpc('account_create_profile',{
          actor:actor.id,new_id:id,login_name:username,person_name:fullName,office_designation:access.designation,
          new_role:access.system_role,slot:access.admin_slot,permissions:access.capabilities,change_password:!localTestAccounts,
        })
        if (added.error) {
          await admin.auth.admin.deleteUser(id)
          return respond(409, { error: 'The account could not be created. Check the role and Admin slot.' })
        }
        return respond(200, { ok:true,username })
      }
      return respond(409, { error: 'No usernames are available for this surname.' })
    } else if (body.action === 'access') {
      result = await admin.from('profiles').update(config()).eq('id', userId).neq('system_role','superadmin').select('id').maybeSingle()
      if (!result.error && !result.data) return respond(403, { error: 'This account cannot be edited.' })
    } else if (body.action === 'active') {
      result = body.active === true ?
        await admin.from('profiles').update({ active: true }).eq('id',userId).select('id').maybeSingle() :
        await admin.rpc('account_lock',{ target:userId,deactivate:true })
      if (!result.error && !result.data) return respond(404, { error: 'Account unavailable.' })
    } else if (body.action === 'reset') {
      if (!strong(body.password)) return respond(400, { error: 'Use at least 12 characters with letters and digits.' })
      const locked = await admin.rpc('account_lock',{ target:userId,deactivate:false })
      if (locked.error || !locked.data) return respond(404, { error: 'Account unavailable.' })
      result = await admin.auth.admin.updateUserById(userId,{ password:body.password })
    } else if (body.action === 'revoke') {
      result = await admin.rpc('account_session_revoke', { target:userId })
    } else return respond(404, { error: 'Unknown operation.' })
    if (result.error) return respond(409, { error: 'The account change could not be applied. Check the role and Admin slot.' })
    const audit = await admin.from('activity_logs').insert({ actor_id:actor.id, entity:'account', entity_id:userId, action:body.action })
    if (audit.error) throw audit.error
    return respond(200, { ok:true })
  } catch {
    return respond(500, { error: 'The account operation could not be completed.' })
  }
})

