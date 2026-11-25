import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const bundleId = 'com.kaleidoswap.wallet';
const marketingVersion = '0.19.3';
const publishedInvite = 'https://testflight.apple.com/join/ddrZT98T';
const inReviewOrApproved = new Set([
  'WAITING_FOR_BETA_REVIEW', 'IN_BETA_REVIEW', 'BETA_APPROVED',
  'READY_FOR_BETA_TESTING', 'IN_BETA_TESTING',
]);

function request(operation, method, path, body) {
  const args = ['scripts/asc-api.mjs', method, path];
  if (body) args.push(JSON.stringify(body));
  const reply = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 30_000 });
  const header = reply.stdout?.match(/^HTTP (\d{3})\r?\n/);
  if (!header) throw new Error(operation + ' did not receive an HTTP response');
  const raw = reply.stdout.slice(header[0].length).trim();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(operation + ' returned an invalid response');
  }
  if (reply.status !== 0) {
    const errors = (payload?.errors ?? []).map(item => item.code)
      .filter(code => typeof code === 'string' && /^[A-Z0-9_.]+$/.test(code)).slice(0, 4);
    throw new Error(operation + ' failed with HTTP ' + header[1] + (errors.length ? ' (' + errors.join(', ') + ')' : ''));
  }
  return payload;
}

function get(operation, route, filters) {
  return request(operation, 'GET', route + '?' + new URLSearchParams(filters));
}

function readBuild(app, buildNumber) {
  const result = get('Approved build lookup', '/v1/builds', {
    'filter[app]': app,
    'filter[version]': buildNumber,
    'filter[preReleaseVersion.version]': marketingVersion,
    'fields[builds]': 'version,processingState,expired,buildAudienceType,preReleaseVersion,buildBetaDetail,betaGroups,betaAppReviewSubmission',
    'fields[preReleaseVersions]': 'version,platform',
    'fields[buildBetaDetails]': 'externalBuildState,internalBuildState',
    'fields[betaAppReviewSubmissions]': 'betaReviewState',
    'limit[betaGroups]': '50',
    include: 'preReleaseVersion,buildBetaDetail,betaGroups,betaAppReviewSubmission',
    limit: '2',
  });
  const included = new Map((result.included ?? []).map(item => [item.type + ':' + item.id, item.attributes]));
  const attributesOf = item => item && included.get(item.type + ':' + item.id);
  const matches = result.data.filter(build => {
    const prerelease = attributesOf(build.relationships.preReleaseVersion?.data);
    return build.attributes.version === buildNumber && prerelease?.platform === 'IOS' &&
      prerelease.version === marketingVersion;
  });
  if (matches.length !== 1) throw new Error('The approved iOS version and build do not resolve uniquely');
  const build = matches[0];
  if (build.attributes.processingState !== 'VALID' || build.attributes.expired !== false ||
      build.attributes.buildAudienceType === 'INTERNAL_ONLY') {
    throw new Error('The approved build must be valid, unexpired and eligible for external distribution');
  }
  const details = attributesOf(build.relationships.buildBetaDetail?.data);
  const external = details?.externalBuildState;
  if (!external) throw new Error('Apple did not return an external beta state for the approved build');
  if (!Array.isArray(build.relationships.betaGroups?.data)) {
    throw new Error('Apple did not return beta group assignments for the approved build');
  }
  const submission = build.relationships.betaAppReviewSubmission?.data;
  return {
    id: build.id,
    external,
    internal: details?.internalBuildState,
    submission,
    review: attributesOf(submission)?.betaReviewState,
    groupIds: new Set(build.relationships.betaGroups.data.map(group => group.id)),
  };
}

async function verifyMutation(action, read, expected, failureMessage) {
  let mutationError;
  try {
    action();
  } catch (error) {
    mutationError = error;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = read();
    if (expected(current)) return current;
    if (attempt < 4) await delay(1000);
  }
  throw mutationError ?? new Error(failureMessage);
}

async function main() {
  const buildNumber = readFileSync('.github/testflight-v019-build.txt', 'utf8').trim();
  if (!/^[1-9][0-9]{0,8}$/.test(buildNumber)) throw new Error('Supply one approved numeric TestFlight build number');

  const apps = get('Production app lookup', '/v1/apps', {
    'filter[bundleId]': bundleId,
    'fields[apps]': 'bundleId',
    limit: '2',
  }).data;
  if (apps.length !== 1 || apps[0].attributes.bundleId !== bundleId) {
    throw new Error('The approved production app does not resolve uniquely');
  }
  const app = apps[0].id;
  const groups = get('Published invite lookup', '/v1/betaGroups', {
    'filter[app]': app,
    'filter[isInternalGroup]': 'false',
    'fields[betaGroups]': 'isInternalGroup,publicLinkEnabled,publicLink',
    limit: '200',
  }).data;
  const matches = groups.filter(group =>
    group.attributes.isInternalGroup === false && group.attributes.publicLinkEnabled === true &&
    group.attributes.publicLink === publishedInvite
  );
  if (matches.length !== 1) throw new Error('The existing enabled external invite does not resolve uniquely');
  const group = matches[0].id;
  let current = readBuild(app, buildNumber);
  if (current.external !== 'READY_FOR_BETA_SUBMISSION' && !inReviewOrApproved.has(current.external)) {
    throw new Error('The approved build cannot advance to external testing from ' + current.external);
  }
  const approvedBuild = current.id;
  const read = () => {
    const result = readBuild(app, buildNumber);
    if (result.id !== approvedBuild) throw new Error('The approved build resource changed');
    return result;
  };
  const buildData = { type: 'builds', id: approvedBuild };
  const assignedToInvite = current => current.groupIds.has(group);
  console.log('Verified ' + marketingVersion + ' (' + buildNumber + ') and the existing enabled external invite.');

  if (!assignedToInvite(current)) {
    current = await verifyMutation(
      () => request('External group assignment', 'POST',
        '/v1/betaGroups/' + encodeURIComponent(group) + '/relationships/builds', { data: [buildData] }),
      read, assignedToInvite, 'Apple did not report the requested external group assignment',
    );
  }
  console.log('The approved build is assigned to the existing external group.');

  if (!current.submission && current.external === 'READY_FOR_BETA_SUBMISSION') {
    current = await verifyMutation(
      () => request('External beta review submission', 'POST', '/v1/betaAppReviewSubmissions', {
        data: { type: 'betaAppReviewSubmissions', relationships: { build: { data: buildData } } },
      }),
      read, current => current.submission || inReviewOrApproved.has(current.external),
      'Apple did not report a beta review submission',
    );
  } else if (!current.submission && !inReviewOrApproved.has(current.external)) {
    throw new Error('Apple changed the build to ' + current.external + ' after assignment');
  }
  if (!assignedToInvite(current)) throw new Error('The approved build no longer belongs to the existing external group');

  if (current.internal) console.log('Internal build state ' + current.internal + '.');
  console.log('External build state ' + current.external + '.');
  if (current.review) console.log('Beta review state ' + current.review + '.');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
