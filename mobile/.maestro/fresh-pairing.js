// Fixture setup runs on the CI host, including for the Android emulator.
// Authenticate only the disposable QA account and mint through the production
// endpoint immediately before slow native entry. The five-minute TTL is intact.
const origin = 'http://127.0.0.1:39218';
const login = http.post(origin + '/api/login', {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'native-smoke',
    password: 'native-smoke-test-password',
  }),
});
if (login.status !== 200) throw new Error('Disposable QA login failed');
const owner = json(login.body).user;
if (!owner || owner.username !== 'native-smoke' || !owner.id)
  throw new Error('Unexpected native smoke owner');
const cookieKey = Object.keys(login.headers).find(
  (key) => key.toLowerCase() === 'set-cookie',
);
if (!cookieKey) throw new Error('Disposable QA login omitted its session');
const cookie = login.headers[cookieKey].split(';')[0];
const paired = http.post(origin + '/api/devices/pair', {
  headers: { Cookie: cookie, 'X-Kuraki-Owner-ID': owner.id },
});
if (paired.status !== 201) throw new Error('Disposable pairing-code creation failed');
const data = json(paired.body);
if (!/^[a-f0-9]{64}$/.test(data.code) ||
    !(Date.parse(data.expires_at) > Date.now() + 4 * 60 * 1000))
  throw new Error('Native smoke pairing code is invalid or already near expiry');
output.freshPairCode = data.code;
