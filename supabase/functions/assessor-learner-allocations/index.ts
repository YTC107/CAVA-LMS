const origin = 'https://ytc107.github.io';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
  if (!base || !serviceKey) throw new Error('Allocation backend is not configured.');
  const {createClient} = await import('npm:@supabase/supabase-js@2.57.4');
  adminClient = createClient(base, serviceKey, {auth: {persistSession: false, autoRefreshToken: false}});
  return adminClient;
}
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers: {...headers, 'Content-Type': 'application/json'}});
async function authenticatedUser(req: Request) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const {data, error} = await (await getAdmin()).auth.getUser(token);
  if (error || !data.user?.id || !data.user.email_confirmed_at) return null;
  return data.user;
}
async function requireManager(userId: string) {
  const {data, error} = await (await getAdmin()).from('super_admins').select('id').eq('user_id', userId).maybeSingle();
  if (error) throw new Error('Unable to verify allocation-management access.');
  if (!data) return false;
  return true;
}
function validSlot(value: unknown): value is 'l1' | 'l2' { return value === 'l1' || value === 'l2'; }
function validUuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
async function targetAssessorExists(id: string) {
  const {data, error} = await (await getAdmin()).auth.admin.getUserById(id);
  if (error) throw new Error('Unable to verify the target assessor.');
  if (!data.user) return false;
  const {data: learnerProfile, error: profileError} = await (await getAdmin()).from('learners').select('id').eq('auth_user_id', id).maybeSingle();
  if (profileError) throw new Error('Unable to verify the target Hub assessor profile.');
  return Boolean(learnerProfile);
}
async function learnerRecord(id: string) {
  const {data, error} = await (await getAdmin()).from('learners').select('id,full_name,email,account_status').eq('id', id).maybeSingle();
  if (error) throw new Error('Unable to verify the learner.');
  return data;
}
async function listAllocations(targetAssessorId: string) {
  const {data, error} = await (await getAdmin()).from('assessor_assignments table').select('id,assessor_id,learner_id,learner_slot,created_at').eq('assessor_id', targetAssessorId).in('learner_slot', ['l1', 'l2']);
  if (error) throw new Error('Allocations could not be loaded.');
  const ids = (data || []).map(row => row.learner_id).filter(Boolean);
  const {data: learners} = ids.length ? await (await getAdmin()).from('learners').select('id,full_name,email,account_status').in('id', ids) : {data: []};
  const byId = new Map((learners || []).map(row => [row.id, row]));
  return (data || []).map(row => ({...row, learner: byId.get(row.learner_id) || null}));
}
async function assign(targetAssessorId: string, learnerId: string, learnerSlot: 'l1' | 'l2') {
  if (!(await targetAssessorExists(targetAssessorId))) return json({error: 'Target assessor does not exist.'}, 404);
  const learner = await learnerRecord(learnerId);
  if (!learner) return json({error: 'Learner does not exist.'}, 404);
  const admin = await getAdmin();
  const {data: other, error: otherError} = await admin.from('assessor_assignments table').select('id').eq('assessor_id', targetAssessorId).eq('learner_id', learnerId).neq('learner_slot', learnerSlot).maybeSingle();
  if (otherError) throw new Error('Unable to validate the other learner slot.');
  if (other) return json({error: 'This learner is already assigned to the other learner slot.'}, 409);
  const {data: existing, error: existingError} = await admin.from('assessor_assignments table').select('id').eq('assessor_id', targetAssessorId).eq('learner_slot', learnerSlot).maybeSingle();
  if (existingError) throw new Error('Unable to load the existing learner slot.');
  const payload = {assessor_id: targetAssessorId, learner_id: learnerId, learner_slot: learnerSlot};
  const result = existing
    ? await admin.from('assessor_assignments table').update({learner_id: learnerId}).eq('id', existing.id).select('id,assessor_id,learner_id,learner_slot').single()
    : await admin.from('assessor_assignments table').insert(payload).select('id,assessor_id,learner_id,learner_slot').single();
  if (result.error) return json({error: 'The learner allocation could not be saved.'}, 409);
  return json({allocation: {...result.data, learner}});
}
export async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers});
  if (req.method !== 'POST') return json({error: 'Method not allowed.'}, 405);
  if (req.headers.get('origin') && req.headers.get('origin') !== origin) return json({error: 'Origin not allowed.'}, 403);
  try {
    const user = await authenticatedUser(req);
    if (!user || !(await requireManager(user.id))) return json({error: 'Only authorised Assessor Hub managers may change learner allocations.'}, 403);
    const body = await req.json();
    if (!validUuid(body.targetAssessorId)) return json({error: 'Invalid target assessor.'}, 400);
    if (body.action === 'list') return json({allocations: await listAllocations(body.targetAssessorId)});
    if (body.action === 'assign') {
      if (!validUuid(body.learnerId) || !validSlot(body.learnerSlot)) return json({error: 'A valid learner and learner slot are required.'}, 400);
      return await assign(body.targetAssessorId, body.learnerId, body.learnerSlot);
    }
    if (body.action === 'remove') {
      if (!validSlot(body.learnerSlot)) return json({error: 'A valid learner slot is required.'}, 400);
      const {error} = await (await getAdmin()).from('assessor_assignments table').delete().eq('assessor_id', body.targetAssessorId).eq('learner_slot', body.learnerSlot);
      if (error) return json({error: 'The learner allocation could not be removed.'}, 409);
      return json({removed: true, learnerSlot: body.learnerSlot});
    }
    return json({error: 'Unknown allocation action.'}, 400);
  } catch (error) {
    console.error('Learner allocation operation failed', error);
    return json({error: 'Learner allocation operation could not be completed.'}, 503);
  }
}
Deno.serve(handler);
