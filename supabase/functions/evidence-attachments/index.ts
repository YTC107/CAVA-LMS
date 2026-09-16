import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const origin = 'https://ytc107.github.io';
const bucket = 'cava-evidence';
const base = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(base, serviceKey, {auth: {persistSession: false, autoRefreshToken: false}});
const headers = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store'
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status, headers: {...headers, 'Content-Type': 'application/json'}});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const unitCode = /^unit[23]$/;
const loCode = /^lo[1-9][0-9]*$/;
const criterionCode = /^[1-9][0-9]*\.[1-9][0-9]*$/;
const allowedTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'image/jpeg', 'image/png', 'image/gif', 'image/webp'
]);

function pathFor(owner: string, learner: string, unit: string, lo: string, criterion: string, attachment: string) {
  return `owner/${owner}/learner/${learner}/unit/${unit}/lo/${lo}/ac/${criterion}/attachment/${attachment}`;
}
function invalidContext(body: Record<string, unknown>) {
  return typeof body.learnerId !== 'string' || !UUID.test(body.learnerId)
    || typeof body.unitCode !== 'string' || !unitCode.test(body.unitCode)
    || typeof body.learningOutcomeCode !== 'string' || !loCode.test(body.learningOutcomeCode)
    || typeof body.assessmentCriterion !== 'string' || !criterionCode.test(body.assessmentCriterion);
}
async function isSuperAdmin(owner: string) {
  const {data: adminRow, error: adminError} = await admin.from('super_admins').select('id').eq('user_id', owner).maybeSingle();
  if (adminError) throw new Error('Unable to verify account access.');
  return Boolean(adminRow);
}
async function allocationExists(owner: string, learnerId: string) {
  const {data, error} = await admin.from('assessor_assignments table').select('id').eq('assessor_id', owner).eq('learner_id', learnerId).limit(1).maybeSingle();
  if (error) throw new Error('Unable to verify learner allocation.');
  return Boolean(data);
}
async function authorised(owner: string, learnerId: string) {
  return (await isSuperAdmin(owner)) || (await allocationExists(owner, learnerId));
}
async function userFromRequest(req: Request) {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const {data, error} = await admin.auth.getUser(token);
  if (error || !data.user?.id || !data.user.email_confirmed_at) return null;
  return data.user;
}
async function attachmentContext(owner: string, attachmentId: string) {
  if (!UUID.test(attachmentId)) return null;
  const {data, error} = await admin.from('evidence_attachments').select('*').eq('id', attachmentId).neq('status', 'removed').maybeSingle();
  if (error) throw new Error('Unable to load evidence.');
  if (!data) return null;
  if (!(await isSuperAdmin(owner)) && (data.owner_id !== owner || !(await allocationExists(owner, data.learner_id)))) return null;
  return data;
}
async function handleCreateUpload(owner: string, body: Record<string, unknown>) {
  if (invalidContext(body)) return json({error: 'Invalid evidence context.'}, 400);
  const filename = typeof body.originalFilename === 'string' ? body.originalFilename.trim() : '';
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType.toLowerCase() : '';
  const byteSize = Number(body.byteSize);
  if (!filename || filename.length > 255 || /[\u0000-\r]/.test(filename) || !allowedTypes.has(mimeType) || !Number.isSafeInteger(byteSize) || byteSize < 1) return json({error: 'Unsupported or invalid file metadata.'}, 400);
  if (!(await allocationExists(owner, body.learnerId as string))) return json({error: 'Learner is not allocated to this assessor.'}, 403);
  const id = crypto.randomUUID();
  const path = pathFor(owner, body.learnerId as string, body.unitCode as string, body.learningOutcomeCode as string, body.assessmentCriterion as string, id);
  const {data, error} = await admin.storage.from(bucket).createSignedUploadUrl(path);
  if (error || !data?.token) return json({error: 'Could not prepare the evidence upload.'}, 503);
  const {error: insertError} = await admin.from('evidence_attachments').insert({id, owner_id: owner, learner_id: body.learnerId, uploaded_by: owner, storage_bucket: bucket, storage_path: path, original_filename: filename, mime_type: mimeType, byte_size: byteSize, content_hash: typeof body.contentHash === 'string' ? body.contentHash : null, status: 'pending'});
  if (insertError) {
    await admin.storage.from(bucket).remove([path]);
    return json({error: 'Could not prepare the evidence record.'}, 503);
  }
  return json({attachmentId: id, path, token: data.token});
}
async function handleComplete(owner: string, body: Record<string, unknown>) {
  if (invalidContext(body)) return json({error: 'Invalid evidence context.'}, 400);
  const attachment = await attachmentContext(owner, String(body.attachmentId || ''));
  if (!attachment || attachment.status !== 'pending') return json({error: 'Evidence upload is not available.'}, 404);
  const expectedPath = `/unit/${body.unitCode}/lo/${body.learningOutcomeCode}/ac/${body.assessmentCriterion}/attachment/`;
  if (!attachment.storage_path.includes(expectedPath)) return json({error: 'Evidence context does not match the upload.'}, 403);
  const {data: listed, error: listError} = await admin.storage.from(bucket).list(attachment.storage_path.split('/').slice(0, -1).join('/'), {search: attachment.id});
  if (listError || !listed?.some(item => item.name === attachment.id)) {
    await admin.from('evidence_attachments').update({status: 'failed', updated_at: new Date().toISOString()}).eq('id', attachment.id).eq('status', 'pending');
    await admin.storage.from(bucket).remove([attachment.storage_path]);
    return json({error: 'The uploaded file could not be verified.'}, 400);
  }
  // The proof of concept creates the AC 1.1 link. The junction table permits later cross-AC links without duplicating bytes.
  const {data: criterion, error: criterionError} = await admin.from('evidence_attachment_criteria').insert({attachment_id: attachment.id, unit_code: body.unitCode, learning_outcome_code: body.learningOutcomeCode, assessment_criterion: body.assessmentCriterion, evidence_type: typeof body.evidenceType === 'string' ? body.evidenceType : null}).select().single();
  if (criterionError) {
    await admin.from('evidence_attachments').update({status: 'failed', updated_at: new Date().toISOString()}).eq('id', attachment.id).eq('status', 'pending');
    await admin.storage.from(bucket).remove([attachment.storage_path]);
    return json({error: 'The evidence link could not be completed.'}, 400);
  }
  const {data: updated, error: updateError} = await admin.from('evidence_attachments').update({status: 'uploaded', uploaded_at: new Date().toISOString(), updated_at: new Date().toISOString()}).eq('id', attachment.id).eq('status', 'pending').select().single();
  if (updateError) {
    await admin.from('evidence_attachment_criteria').delete().eq('id', criterion.id);
    await admin.from('evidence_attachments').update({status: 'failed', updated_at: new Date().toISOString()}).eq('id', attachment.id).eq('status', 'pending');
    await admin.storage.from(bucket).remove([attachment.storage_path]);
    return json({error: 'The evidence record could not be completed.'}, 503);
  }
  return json({attachment: {...updated, criteria: [criterion]}});
}
async function handleList(owner: string, body: Record<string, unknown>) {
  if (invalidContext(body) || !(await authorised(owner, body.learnerId as string))) return json({error: 'Evidence context is not available.'}, 403);
  const adminUser = await isSuperAdmin(owner);
  let query = admin.from('evidence_attachment_criteria').select('unit_code,learning_outcome_code,assessment_criterion,evidence_type,evidence_attachments!inner(*)').eq('unit_code', body.unitCode).eq('learning_outcome_code', body.learningOutcomeCode).eq('assessment_criterion', body.assessmentCriterion).eq('evidence_attachments.learner_id', body.learnerId).neq('evidence_attachments.status', 'removed').order('created_at', {ascending: true});
  if (!adminUser) query = query.eq('evidence_attachments.owner_id', owner);
  const {data, error} = await query;
  if (error) return json({error: 'Could not load evidence.'}, 503);
  return json({attachments: (data || []).map(row => ({...row.evidence_attachments, evidence_type: row.evidence_type}))});
}
async function handleDownload(owner: string, body: Record<string, unknown>) {
  const attachment = await attachmentContext(owner, String(body.attachmentId || ''));
  if (!attachment || !['uploaded', 'locked'].includes(attachment.status)) return json({error: 'Evidence is not available.'}, 404);
  const {data, error} = await admin.storage.from(bucket).createSignedUrl(attachment.storage_path, 300);
  if (error || !data?.signedUrl) return json({error: 'Could not prepare the download.'}, 503);
  return json({url: data.signedUrl, filename: attachment.original_filename});
}
async function handleRemove(owner: string, body: Record<string, unknown>) {
  const attachment = await attachmentContext(owner, String(body.attachmentId || ''));
  if (!attachment) return json({error: 'Evidence is not available.'}, 404);
  if (attachment.owner_id !== owner) return json({error: 'Only the owning assessor can remove evidence.'}, 403);
  if (attachment.status === 'locked' || attachment.locked_at) return json({error: 'Locked evidence cannot be removed.'}, 409);
  const {error} = await admin.from('evidence_attachments').update({status: 'removed', removed_at: new Date().toISOString(), updated_at: new Date().toISOString()}).eq('id', attachment.id).eq('owner_id', owner).in('status', ['pending', 'uploaded']);
  if (error) return json({error: 'Evidence could not be removed.'}, 503);
  const storageResult = await admin.storage.from(bucket).remove([attachment.storage_path]);
  if (storageResult.error) console.error('Evidence object cleanup failed', attachment.id, storageResult.error.message);
  return json({removed: true, attachmentId: attachment.id});
}
export async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers});
  if (req.method !== 'POST') return json({error: 'Method not allowed.'}, 405);
  if (req.headers.get('origin') && req.headers.get('origin') !== origin) return json({error: 'Origin not allowed.'}, 403);
  const user = await userFromRequest(req);
  if (!user) return json({error: 'Sign in with your confirmed Hub account.'}, 401);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({error: 'Invalid request.'}, 400); }
  try {
    if (body.action === 'create-upload') return await handleCreateUpload(user.id, body);
    if (body.action === 'complete-upload') return await handleComplete(user.id, body);
    if (body.action === 'list') return await handleList(user.id, body);
    if (body.action === 'download') return await handleDownload(user.id, body);
    if (body.action === 'remove') return await handleRemove(user.id, body);
    return json({error: 'Unknown evidence action.'}, 400);
  } catch (error) {
    console.error('Evidence operation failed', error);
    return json({error: 'Evidence operation could not be completed.'}, 503);
  }
}
