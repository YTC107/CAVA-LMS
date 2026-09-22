const origin = 'https://cava-learner-hub.pages.dev';
const headers = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store'
};
let adminClient: any = null;
async function getAdmin() {
  if (adminClient) return adminClient;
  const base = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !serviceKey) throw new Error('Vocational learner backend is not configured.');
  const {createClient} = await import('npm:@supabase/supabase-js@2.57.4');
  adminClient = createClient(base, serviceKey, {auth: {persistSession: false, autoRefreshToken: false}});
  return adminClient;
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers: {...headers, 'Content-Type': 'application/json'}});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i;
const labels = {l1: 'Level 2 Gym Instructor', l2: 'Level 3 Personal Trainer'} as const;
async function userFromRequest(req: Request) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const {data, error} = await (await getAdmin()).auth.getUser(token);
  if (error || !data.user?.id || !data.user.email_confirmed_at) return null;
  return data.user;
}
async function isAdmin(userId: string) {
  const {data, error} = await (await getAdmin()).from('super_admins').select('id').eq('user_id', userId).maybeSingle();
  if (error) throw new Error('Unable to verify oversight access.');
  return Boolean(data);
}
async function listFor(assessorId: string) {
  const {data, error} = await (await getAdmin()).from('cava_vocational_learners').select('id,assessor_id,learner_slot,full_name,email,qualification_label,created_at,updated_at').eq('assessor_id', assessorId).order('learner_slot');
  if (error) throw new Error('Vocational learner details could not be loaded.');
  return data || [];
}
async function resolveAssessorId(value: string) {
  const {data, error} = await (await getAdmin()).from('learners').select('id,auth_user_id').or('id.eq.' + value + ',auth_user_id.eq.' + value).maybeSingle();
  if (error) throw new Error('Unable to resolve the selected trainee assessor identity.');
  return data?.auth_user_id || data?.id || value;
}
function validSlot(value: unknown): value is 'l1' | 'l2' { return value === 'l1' || value === 'l2'; }
export async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers});
  if (req.method !== 'POST') return json({error: 'Method not allowed.'}, 405);
  if (req.headers.get('origin') && req.headers.get('origin') !== origin) return json({error: 'Origin not allowed.'}, 403);
  try {
    const user = await userFromRequest(req);
    if (!user) return json({error: 'Sign in with your confirmed Hub account.'}, 401);
    const body = await req.json();
    const targetAssessorId = typeof body.targetAssessorId === 'string' ? body.targetAssessorId : user.id;
    if (!UUID.test(targetAssessorId)) return json({error: 'Invalid assessor identity.'}, 400);
    const resolvedTargetId = body.action === 'list' ? await resolveAssessorId(targetAssessorId) : targetAssessorId;
    const oversight = resolvedTargetId !== user.id;
    if (oversight && !(await isAdmin(user.id))) return json({error: 'You may only view your own vocational learner details.'}, 403);
    if (body.action === 'list') return json({learners: await listFor(resolvedTargetId)});
    if (oversight) return json({error: 'Oversight access is read-only.'}, 403);
    if (body.action !== 'save') return json({error: 'Unknown vocational learner action.'}, 400);
    if (!validSlot(body.learnerSlot)) return json({error: 'Invalid learner slot.'}, 400);
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim().replace(/\s+/g, ' ') : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (fullName.length < 2 || fullName.length > 160) return json({error: 'Enter the vocational learner full name.'}, 400);
    if (!EMAIL.test(email) || email.length > 254) return json({error: 'Enter a valid vocational learner email address.'}, 400);
    const {data, error} = await (await getAdmin()).from('cava_vocational_learners').upsert({assessor_id: user.id, learner_slot: body.learnerSlot, full_name: fullName, email, qualification_label: labels[body.learnerSlot], updated_at: new Date().toISOString()}, {onConflict: 'assessor_id,learner_slot'}).select('id,assessor_id,learner_slot,full_name,email,qualification_label,created_at,updated_at').single();
    if (error) return json({error: 'Vocational learner details could not be saved.'}, 409);
    return json({learner: data});
  } catch (error) {
    console.error('Vocational learner operation failed', error);
    return json({error: 'Vocational learner operation could not be completed.'}, 503);
  }
}
Deno.serve(handler);
