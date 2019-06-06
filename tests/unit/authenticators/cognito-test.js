import { get, getProperties } from '@ember/object';
import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';
import config from '../../../config/environment';
import { mockAuth, MockAuth, mockCognitoUser } from "ember-cognito/test-support";
import { CognitoUser as AWSUser, CognitoUserPool } from 'amazon-cognito-identity-js';
import { reject } from 'rsvp';

module('Unit | Authenticator | cognito', function(hooks) {
  setupTest(hooks);

  hooks.beforeEach(function() {
    this.newAWSUser = function(username) {
      const service = this.owner.lookup('authenticator:cognito');
      const { poolId, clientId } = getProperties(service, "poolId", "clientId");
      const pool = new CognitoUserPool({ UserPoolId: poolId, ClientId: clientId });
      return new AWSUser({ Username: username, Pool: pool });
    }
  });

  test('config is set correctly', function(assert) {
    let service = this.owner.lookup('authenticator:cognito');
    assert.equal(get(service, 'poolId'), 'us-east-1_TEST');
    assert.equal(get(service, 'clientId'), 'TEST');
    assert.equal(get(service, 'authenticationFlowType'), config.cognito.authenticationFlowType);
  });

  test('restore', async function(assert) {
    await mockCognitoUser({ username: 'testuser' });

    let service = this.owner.lookup('authenticator:cognito');

    const data = { poolId: 'us-east-1_TEST', clientId: 'TEST' };
    let resolvedData = await service.restore(data);
    assert.deepEqual(resolvedData, data, 'The resolved data is correct.');
    assert.ok(get(service, 'cognito.user'), 'The cognito service user is populated.');
    assert.equal(get(service, 'cognito.user.username'), 'testuser', 'The username is set correctly.');
  });

  test('restore no current user', async function(assert) {
    await mockAuth();

    let service = this.owner.lookup('authenticator:cognito');
      try {
        await service.restore({ poolId: 'us-east-1_TEST', clientId: 'TEST' });
        assert.ok(false, 'Should not resolve.');
      } catch (err) {
        assert.deepEqual(err, 'user not authenticated', 'Restore rejects');
      }
  });

  test('authenticateUser', async function(assert) {
    const service = this.owner.lookup('authenticator:cognito');

    const user = this.newAWSUser('testuser');
    const auth = MockAuth.create({ _authenticatedUser: user });
    await mockAuth(auth);

    const data = await service.authenticate({ username: 'testuser', password: 'password' });
    assert.equal(data.poolId, 'us-east-1_TEST');
    assert.equal(data.clientId, 'TEST');
    assert.ok(get(service, 'cognito.user'), 'The cognito service user is populated.');
    assert.equal(get(service, 'cognito.user.username'), 'testuser', 'The username is set correctly.');
  });

  test('authenticateUser, failure', async function(assert) {
    const service = this.owner.lookup('authenticator:cognito');
    const authClass = MockAuth.extend({
      signIn() {
        return reject({ message: 'Username or password incorrect.' });
      }
    });
    await mockAuth(authClass.create());

    try {
      await service.authenticate({ username: 'testuser', password: 'password' });
      assert.ok(false, 'Should not resolve');
    } catch (err) {
      assert.equal(err.message, 'Username or password incorrect.');
    }
  });

  test('authenticateUser, newPasswordRequired', async function(assert) {
    const service = this.owner.lookup('authenticator:cognito');
    let user = this.newAWSUser('testuser');
    user.challengeName = 'NEW_PASSWORD_REQUIRED';
    const authClass = MockAuth.extend({ _authenticatedUser: user });
    await mockAuth(authClass.create());

    let state;
    try {
      await service.authenticate({ username: 'testuser', password: 'password' });
      assert.ok(false, 'Should not resolve');
    } catch (err) {
      state = err.state;
      assert.equal(err.state.name, 'newPasswordRequired');
    }
    user.challengeName = undefined;

    // Call authenticate again with the state and the new password.
    let data = await service.authenticate({ password: 'newPassword', state });
    assert.equal(data.poolId, 'us-east-1_TEST');
    assert.equal(data.clientId, 'TEST');
    assert.ok(get(service, 'cognito.user'), 'The cognito service user is populated.');
    assert.equal(get(service, 'cognito.user.username'), 'testuser', 'The username is set correctly.');
  });

  test('authenticateUser, newPasswordRequired failure', async function(assert) {
    const service = this.owner.lookup('authenticator:cognito');
    let user = this.newAWSUser('testuser');
    user.challengeName = 'NEW_PASSWORD_REQUIRED';
    await mockAuth(MockAuth.extend({ _authenticatedUser: user }).create());

    let state;
    try {
      await service.authenticate({ username: 'testuser', password: 'password' });
      assert.ok(false, 'Should not resolve');
    } catch (err) {
      state = err.state;
      assert.equal(err.state.name, 'newPasswordRequired');
    }

    const authClass = MockAuth.extend({
      completeNewPassword() {
        return reject({ message: 'Invalid password.' });
      }
    });
    await mockAuth(authClass.create());

    try {
      // Call authenticate again with the state and the new password.
      await service.authenticate({ password: 'newPassword', state });
      assert.ok(false, 'Should not resolve');
    } catch (err) {
      assert.equal(err.message, 'Invalid password.');
    }
  });

  test('invalidate', async function(assert) {
    const data = {
      poolId: 'us-east-1_TEST',
      clientId: 'TEST'
    };
    const service = this.owner.lookup('authenticator:cognito');
    await mockCognitoUser({ username: 'testuser' });

    let resolvedData = await service.invalidate(data);
    assert.deepEqual(data, resolvedData);
    // Cognito user no longer exists on service
    assert.equal(get(service, 'cognito.user'), undefined);
  });
});
