import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const start = html.indexOf('  function initialiseAppointmentSupport() {');
const end = html.indexOf('\n  function toggleLOs', start);
const appointmentSupport = html.slice(start, end);

function setup(supportEmail = 'ptacademy.cava.support@gmail.com') {
  const dom = new JSDOM(`
    <meta name="cava-support-email" content="${supportEmail}">
    <button id="prepareAppointmentEmail" type="button">Prepare support email</button>
    <input id="appointmentPreferredDateDisplay" value="16/09/2026">
    <input id="appointmentPreferredDate" value="2026-09-16">
    <input id="appointmentPreferredTime" value="18:30">
    <input id="appointmentAlternativeTime" value="Thursday after 18:00">
    <select id="appointmentSupportType"><option selected>Unit 2 assessment support</option></select>
    <textarea id="appointmentReason">I need help with my assessment plan.</textarea>
    <span id="learnerNameDisplay">Test Learner</span>
    <p id="appointmentRequestStatus"></p>
  `, {url: 'https://example.com/', runScripts: 'outside-only'});
  const {window} = dom;
  window.localStorage.setItem('cava_user', JSON.stringify({email: 'learner@example.com'}));
  window.eval(`${appointmentSupport}; initialiseAppointmentSupport();`);
  return {dom, window, button: window.document.getElementById('prepareAppointmentEmail'), status: window.document.getElementById('appointmentRequestStatus')};
}

test('prepares the complete request and exposes Gmail and copy fallbacks', async () => {
  const {dom, window, button, status} = setup();
  const copied = [];
  Object.defineProperty(window.navigator, 'clipboard', {value: {writeText: async text => copied.push(text)}});
  try {
    button.click();
    const gmailLink = status.querySelector('a');
    const copyButton = status.querySelector('button');
    assert.ok(gmailLink);
    assert.equal(gmailLink.textContent, 'Open in Gmail');
    const gmailUrl = new URL(gmailLink.href);
    assert.equal(gmailUrl.searchParams.get('to'), 'ptacademy.cava.support@gmail.com');
    assert.equal(gmailUrl.searchParams.get('su'), 'CAVA support appointment request: Test Learner');
    const requestBody = gmailUrl.searchParams.get('body');
    assert.match(requestBody, /Support required: Unit 2 assessment support/);
    assert.match(requestBody, /Preferred date: 16\/09\/2026/);
    assert.match(requestBody, /Preferred time: 18:30/);
    assert.match(requestBody, /Alternative availability: Thursday after 18:00/);
    assert.match(requestBody, /Reason for appointment:\nI need help with my assessment plan\./);
    await copyButton.click();
    assert.match(copied[0], /To: ptacademy\.cava\.support@gmail\.com/);
    assert.match(copied[0], /Subject: CAVA support appointment request: Test Learner/);
    assert.match(copied[0], /Account email: learner@example\.com/);
    assert.equal(copyButton.textContent, 'Copy request details');
  } finally {
    dom.window.close();
  }
});

test('rejects a missing or malformed support recipient before preparing mail', () => {
  const {dom, button, status} = setup('not-an-email');
  try {
    button.click();
    assert.match(status.textContent, /Support email is not configured correctly/);
    assert.equal(status.querySelector('a'), null);
    assert.equal(status.querySelector('button'), null);
  } finally {
    dom.window.close();
  }
});
