// Regression-Tests für den Bugfix "Fehler beim Speichern des Portalzugangs"
// (403 forbidden trotz gültiger Admin PIN Session, weil eine alte/fremde
// Supabase-Auth-Sitzung Vorrang hatte). Reine Logik, kein DOM/Netzwerk nötig
// — läuft mit dem in Node eingebauten Testrunner:
//
//   node --test tests/
//
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveAdminAuthToken,
  isExpiredAdminPinSessionError
} = require('../trainer-portal-auth-token.js');

test('A: nur Admin PIN Session vorhanden -> PIN-Token wird verwendet', () => {
  const result = resolveAdminAuthToken({ adminPinToken: 'ADMIN_PIN_TOKEN', authAccessToken: null });
  assert.equal(result.token, 'ADMIN_PIN_TOKEN');
  assert.equal(result.source, 'pin');
});

test('B: nur Supabase Auth Admin JWT vorhanden -> JWT wird verwendet (Fallback)', () => {
  const result = resolveAdminAuthToken({ adminPinToken: null, authAccessToken: 'AUTH_ADMIN_JWT' });
  assert.equal(result.token, 'AUTH_ADMIN_JWT');
  assert.equal(result.source, 'auth');
});

test('C (Haupt-Regressionstest): alte Trainer-Auth-Sitzung + gültige Admin PIN Session -> PIN Session gewinnt, Trainer-JWT wird NICHT verwendet', () => {
  const result = resolveAdminAuthToken({
    adminPinToken: 'ADMIN_PIN_TOKEN',
    authAccessToken: 'STALE_TRAINER_AUTH_JWT'
  });
  assert.equal(result.source, 'pin');
  assert.equal(result.token, 'ADMIN_PIN_TOKEN');
  assert.notEqual(result.token, 'STALE_TRAINER_AUTH_JWT');
});

test('D: Auth Admin JWT UND Admin PIN Session gleichzeitig vorhanden -> PIN Session hat Vorrang', () => {
  const result = resolveAdminAuthToken({
    adminPinToken: 'ADMIN_PIN_TOKEN',
    authAccessToken: 'ADMIN_AUTH_JWT'
  });
  assert.equal(result.source, 'pin');
  assert.equal(result.token, 'ADMIN_PIN_TOKEN');
});

test('E: lokale Admin PIN Session vom Server als abgelaufen abgelehnt (401 invalid_or_expired_token) -> wird als abgelaufene PIN-Session erkannt', () => {
  const expired = isExpiredAdminPinSessionError({
    tokenSource: 'pin',
    httpStatus: 401,
    errorCode: 'invalid_or_expired_token'
  });
  assert.equal(expired, true);
});

test('E (Gegenprobe): derselbe 401-Fehlercode, aber Token kam aus dem Auth-JWT-Fallback -> NICHT als abgelaufene PIN-Session behandelt (kein PIN-Session-Aufräumen ohne PIN-Session)', () => {
  const expired = isExpiredAdminPinSessionError({
    tokenSource: 'auth',
    httpStatus: 401,
    errorCode: 'invalid_or_expired_token'
  });
  assert.equal(expired, false);
});

test('F: weder PIN Session noch Auth-Sitzung vorhanden -> kein Token', () => {
  const result = resolveAdminAuthToken({ adminPinToken: null, authAccessToken: null });
  assert.equal(result.token, null);
  assert.equal(result.source, null);
});

test('403 forbidden (Rollenprüfung des Ziel-/Aufrufer-Trainers) wird NICHT als abgelaufene PIN-Session behandelt', () => {
  const expired = isExpiredAdminPinSessionError({
    tokenSource: 'pin',
    httpStatus: 403,
    errorCode: 'forbidden'
  });
  assert.equal(expired, false);
});

test('leere Strings zählen wie "nicht vorhanden" (Konsistenz mit Falsy-Check im Frontend)', () => {
  const result = resolveAdminAuthToken({ adminPinToken: '', authAccessToken: 'AUTH_JWT' });
  assert.equal(result.source, 'auth');
});
