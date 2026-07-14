// SUPABASE SETUP - Add to HEAD of all pages
// <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================================
// LOGIN PAGE - login.html
// ============================================================================

async function handleLogin(email, password) {
  try {
    // 1. Authenticate with Supabase Auth
    const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: password
    });

    if (authError) {
      alert('Login failed: ' + authError.message);
      return false;
    }

    // 2. Fetch user role from learners table
    const { data: learnerData } = await supabaseClient
      .from('learners')
      .select('id, role, full_name')
      .eq('email', email)
      .single();

    if (learnerData && learnerData.role === 'learner') {
      localStorage.setItem('userRole', 'learner');
      localStorage.setItem('userId', authData.user.id);
      localStorage.setItem('userName', learnerData.full_name);
      window.location.href = 'learner-allocation.html';
      return true;
    }

    // 3. Check if user is assessor (exists in assessor_assignments table)
    const { data: assessorData } = await supabaseClient
      .from('"assessor_assignments table"')
      .select('id, role')
      .eq('assessor_id', authData.user.id)
      .single();

    if (assessorData && assessorData.role === 'assessor') {
      localStorage.setItem('userRole', 'assessor');
      localStorage.setItem('userId', authData.user.id);
      localStorage.setItem('userName', email);
      window.location.href = 'assessor-hub.html';
      return true;
    }

    // 4. Admin check (optional - add admin column to learners if needed)
    if (learnerData && learnerData.role === 'admin') {
      localStorage.setItem('userRole', 'admin');
      localStorage.setItem('userId', authData.user.id);
      window.location.href = 'assessor-management.html';
      return true;
    }

    alert('User role not found. Contact administrator.');
    return false;

  } catch (error) {
    console.error('Login error:', error);
    alert('An error occurred. Please try again.');
    return false;
  }
}

function handleLogout() {
  supabaseClient.auth.signOut();
  localStorage.clear();
  window.location.href = 'login.html';
}

// ============================================================================
// LEARNER HUB - learner-allocation.html
// ============================================================================

async function loadLearnerDashboard() {
  const learnerId = localStorage.getItem('userId');
  const userName = localStorage.getItem('userName');

  try {
    // Fetch assigned assessor(s)
    const { data: assessorData } = await supabaseClient
      .from('"assessor_assignments table"')
      .select('assessor_id, role')
      .eq('learner_id', learnerId);

    // Fetch assigned units
    const { data: unitData } = await supabaseClient
      .from('learner_unit_allocations')
      .select('id, unit_id, unit_name, status, created_at')
      .eq('learner_id', learnerId);

    // Display learner name
    document.getElementById('learnerName').textContent = userName;

    // Display assessor(s)
    const assessorList = document.getElementById('assignedAssessors');
    assessorList.innerHTML = '';
    assessorData.forEach(assessor => {
      const li = document.createElement('li');
      li.textContent = `Assessor ID: ${assessor.assessor_id}`;
      assessorList.appendChild(li);
    });

    // Display units
    const unitList = document.getElementById('unitList');
    unitList.innerHTML = '';
    unitData.forEach(unit => {
      const row = `
        <tr>
          <td>${unit.unit_name}</td>
          <td>${unit.status || 'Not Started'}</td>
          <td>
            <button onclick="markUnitComplete('${unit.id}')">Mark Complete</button>
          </td>
        </tr>
      `;
      unitList.innerHTML += row;
    });

  } catch (error) {
    console.error('Dashboard load error:', error);
  }
}

async function markUnitComplete(unitId) {
  try {
    const { error } = await supabaseClient
      .from('learner_unit_allocations')
      .update({ status: 'Completed', updated_at: new Date() })
      .eq('id', unitId);

    if (error) throw error;
    alert('Unit marked complete. Assessor will be notified.');
    loadLearnerDashboard();
  } catch (error) {
    console.error('Update error:', error);
    alert('Failed to update unit status.');
  }
}

// ============================================================================
// ASSESSOR HUB - assessor-hub.html
// ============================================================================

async function loadAssessorDashboard() {
  const assessorId = localStorage.getItem('userId');

  try {
    // Fetch assigned learners
    const { data: learners } = await supabaseClient
      .from('"assessor_assignments table"')
      .select('learner_id, role')
      .eq('assessor_id', assessorId);

    const learnerIds = learners.map(l => l.learner_id);

    // Fetch learner details and unit allocations
    const { data: learnerDetails } = await supabaseClient
      .from('learners')
      .select('id, full_name, email')
      .in('id', learnerIds);

    const { data: unitAllocations } = await supabaseClient
      .from('learner_unit_allocations')
      .select('id, learner_id, unit_name, status, created_at')
      .in('learner_id', learnerIds);

    // Display learners
    const learnerList = document.getElementById('assignedLearners');
    learnerList.innerHTML = '';

    learnerDetails.forEach(learner => {
      const learnerUnits = unitAllocations.filter(u => u.learner_id === learner.id);
      const html = `
        <div class="learner-card">
          <h3>${learner.full_name}</h3>
          <p>${learner.email}</p>
          <button onclick="viewMarkingInterface('${learner.id}', '${learner.full_name}')">Mark Assessments</button>
          <ul>
            ${learnerUnits.map(u => `<li>${u.unit_name} - ${u.status}</li>`).join('')}
          </ul>
        </div>
      `;
      learnerList.innerHTML += html;
    });

  } catch (error) {
    console.error('Dashboard error:', error);
  }
}

// ============================================================================
// MARKING INTERFACE - assessor-hub.html
// ============================================================================

let currentMarkingData = {};

function viewMarkingInterface(learnerId, learnerName) {
  currentMarkingData.learnerId = learnerId;
  currentMarkingData.learnerName = learnerName;
  document.getElementById('markingPanel').style.display = 'block';
  document.getElementById('markingLearnerName').textContent = learnerName;
}

async function submitMarkingFeedback(grade, feedback) {
  const assessorId = localStorage.getItem('userId');
  const timestamp = new Date().toISOString();

  try {
    // Save to learner_unit_allocations with feedback and timestamp
    const { error } = await supabaseClient
      .from('learner_unit_allocations')
      .update({
        status: 'Marked',
        grade: grade,
        feedback: feedback,
        marked_by: assessorId,
        marked_at: timestamp,
        updated_at: timestamp
      })
      .eq('learner_id', currentMarkingData.learnerId);

    if (error) throw error;
    alert('Feedback submitted. Timestamps recorded for moderation.');
    loadAssessorDashboard();
    document.getElementById('markingPanel').style.display = 'none';
  } catch (error) {
    console.error('Feedback submission error:', error);
    alert('Failed to submit feedback.');
  }
}

// ============================================================================
// PDF EXPORT - assessor-hub.html
// ============================================================================

async function downloadModeratedFeedbackPDF(learnerId) {
  try {
    // Fetch all feedback records for learner
    const { data: feedbackData } = await supabaseClient
      .from('learner_unit_allocations')
      .select('*')
      .eq('learner_id', learnerId);

    // Generate PDF content
    let pdfContent = `
      LEARNER ASSESSMENT FEEDBACK REPORT
      Generated: ${new Date().toISOString()}
      
      `;

    feedbackData.forEach(record => {
      pdfContent += `
      Unit: ${record.unit_name}
      Grade: ${record.grade || 'N/A'}
      Feedback: ${record.feedback || 'No feedback'}
      Marked By: ${record.marked_by || 'N/A'}
      Marked At: ${record.marked_at || 'N/A'}
      ________________________________
      `;
    });

    // Simple PDF generation (use html2pdf library for production)
    const element = document.createElement('div');
    element.textContent = pdfContent;
    const file = new Blob([pdfContent], { type: 'text/plain' });
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Feedback_${learnerId}_${new Date().getTime()}.txt`;
    link.click();

  } catch (error) {
    console.error('PDF export error:', error);
    alert('Failed to generate report.');
  }
}

// ============================================================================
// SESSION CHECK - Run on all pages except login
// ============================================================================

function checkSession() {
  const userRole = localStorage.getItem('userRole');
  if (!userRole) {
    window.location.href = 'login.html';
  }
}

// Run on page load
window.addEventListener('load', () => {
  if (window.location.pathname !== '/login.html') {
    checkSession();
  }
});
