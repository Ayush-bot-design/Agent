import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateUserReferenceVector,
  calculateFacialMatchDistance,
  evaluateLiveFacialScan,
  analyzeCanvasFrameForHumanFace,
  extractFacialVectorFromImageData,
  getUserFacialProfile,
} from './facial-verification.ts';

test('generateUserReferenceVector generates consistent 128-D vectors for user keys', () => {
  const v1 = generateUserReferenceVector('shivam');
  const v2 = generateUserReferenceVector('shivam');
  const v3 = generateUserReferenceVector('binod');

  assert.equal(v1.length, 128);
  assert.equal(v2.length, 128);
  assert.deepEqual(v1, v2);
  assert.notDeepEqual(v1, v3);
});

test('calculateFacialMatchDistance computes lower distance for matching faces than different faces', () => {
  const refShivam = generateUserReferenceVector('shivam');
  const refBinod = generateUserReferenceVector('binod');

  // Slight jitter on same person
  const liveShivam = refShivam.map((val) => val + 0.02);

  const sameDistance = calculateFacialMatchDistance(refShivam, liveShivam);
  const diffDistance = calculateFacialMatchDistance(refShivam, refBinod);

  assert.ok(sameDistance < 0.2, 'Matching user distance should be low (< 0.20)');
  assert.ok(diffDistance > 0.4, 'Different user distance should be higher (> 0.40)');
});

test('analyzeCanvasFrameForHumanFace detects face skin vs empty background frames', () => {
  const width = 160;
  const height = 120;

  // 1. Mock empty room background (green wall / ceiling fan pixels)
  const roomData = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < roomData.length; i += 4) {
    roomData[i] = 40; // R
    roomData[i + 1] = 160; // G (Green wall)
    roomData[i + 2] = 90; // B
    roomData[i + 3] = 255;
  }
  const roomFrame = { data: roomData, width, height } as ImageData;
  const roomAnalysis = analyzeCanvasFrameForHumanFace(roomFrame, width, height);

  assert.equal(roomAnalysis.hasFace, false);
  assert.ok(roomAnalysis.skinRatioPercent < 15.0);
  assert.ok(roomAnalysis.reason?.includes('No human face detected'));

  // 2. Mock human skin face frame with natural facial feature variance
  const faceData = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < faceData.length; i += 4) {
    const v = i % 60;
    // Skin tone RGB (R > G > B) with natural facial feature contour variance
    faceData[i] = Math.min(255, 190 + v); // R
    faceData[i + 1] = Math.min(255, 130 + v); // G
    faceData[i + 2] = Math.min(255, 90 + v / 2); // B
    faceData[i + 3] = 255;
  }
  const faceFrame = { data: faceData, width, height } as ImageData;
  const faceAnalysis = analyzeCanvasFrameForHumanFace(faceFrame, width, height);

  assert.equal(faceAnalysis.hasFace, true);
  assert.ok(faceAnalysis.skinRatioPercent >= 15.0);
});

test('analyzeCanvasFrameForHumanFace explicitly rejects hands and palms with multi-finger gaps', () => {
  const width = 160;
  const height = 120;
  const handData = new Uint8ClampedArray(width * height * 4);

  // Fill frame with background room color
  for (let i = 0; i < handData.length; i += 4) {
    handData[i] = 30;
    handData[i + 1] = 40;
    handData[i + 2] = 50;
    handData[i + 3] = 255;
  }

  // Draw 4 finger columns with skin pixels in upper scanning region (y: 24 to 50)
  for (let y = 24; y < 50; y++) {
    const fingerRanges = [
      [30, 40],
      [55, 65],
      [80, 90],
      [105, 115],
    ];

    for (const [fStart, fEnd] of fingerRanges) {
      for (let x = fStart; x < fEnd; x++) {
        const idx = (y * width + x) * 4;
        handData[idx] = 210; // R skin
        handData[idx + 1] = 145; // G skin
        handData[idx + 2] = 100; // B skin
        handData[idx + 3] = 255;
      }
    }
  }

  const handFrame = { data: handData, width, height } as ImageData;
  const handAnalysis = analyzeCanvasFrameForHumanFace(handFrame, width, height);

  assert.equal(handAnalysis.hasFace, false);
  assert.equal(handAnalysis.isHandOrPalm, true);
  assert.ok(handAnalysis.reason?.includes('Hand / Palm Detected'));
});

test('extractFacialVectorFromImageData extracts 128-D Z-score spatial vector from canvas pixels', () => {
  const width = 160;
  const height = 120;
  const frameData = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < frameData.length; i += 4) {
    frameData[i] = (i * 7) % 256;
    frameData[i + 1] = (i * 13) % 256;
    frameData[i + 2] = (i * 19) % 256;
    frameData[i + 3] = 255;
  }
  const imgData = { data: frameData, width, height } as ImageData;
  const vector = extractFacialVectorFromImageData(imgData, width, height);

  assert.equal(vector.length, 128);
  assert.ok(vector.every((val) => typeof val === 'number' && !isNaN(val)));
});

test('analyzeCanvasFrameForHumanFace never misclassifies a human face with dark eyebrows and eyes as a hand', () => {
  const width = 160;
  const height = 120;
  const faceData = new Uint8ClampedArray(width * height * 4);

  // Fill background
  for (let i = 0; i < faceData.length; i += 4) {
    faceData[i] = 100;
    faceData[i + 1] = 110;
    faceData[i + 2] = 95;
    faceData[i + 3] = 255;
  }

  // Draw face skin across upper and lower face (y: 20 to 105, x: 45 to 115)
  for (let y = 20; y < 105; y++) {
    for (let x = 45; x < 115; x++) {
      const idx = (y * width + x) * 4;
      faceData[idx] = 195 + ((x + y) % 20);
      faceData[idx + 1] = 135 + ((x + y) % 15);
      faceData[idx + 2] = 95;
      faceData[idx + 3] = 255;
    }
  }

  // Add dark eyebrows/eyes in upper scan zone (y: 32 to 44) creating 3 skin segments (temple, nose bridge, temple)
  for (let y = 32; y < 44; y++) {
    for (const [eyeStart, eyeEnd] of [
      [55, 72],
      [88, 105],
    ]) {
      for (let x = eyeStart; x < eyeEnd; x++) {
        const idx = (y * width + x) * 4;
        faceData[idx] = 25;
        faceData[idx + 1] = 22;
        faceData[idx + 2] = 20;
        faceData[idx + 3] = 255;
      }
    }
  }

  const faceFrame = { data: faceData, width, height } as ImageData;
  const analysis = analyzeCanvasFrameForHumanFace(faceFrame, width, height);

  assert.equal(analysis.isHandOrPalm, false);
  assert.equal(analysis.hasFace, true);
});

test('createFingerprintVerificationResult creates valid BIO-FINGERPRINT seal with epoch timestamp and optional attendance telemetry', async () => {
  const { createFingerprintVerificationResult } = await import('./facial-verification.ts');
  const { parseSiteTimestampMs } = await import('./deployment-logic.ts');

  const beforeMs = Date.now();
  const res = createFingerprintVerificationResult({
    userKey: '@Piyush',
    hardwareAuthenticatorUsed: true,
    latitude: 26.66612,
    longitude: 80.94621,
    accuracyMeters: 8,
  });
  const afterMs = Date.now();

  assert.equal(res.success, true);
  assert.equal(res.userKey, 'piyush');
  assert.match(res.verificationId, /^BIO-FINGERPRINT-\d{13}-[A-Z0-9]+$/);
  assert.ok(res.confidenceScore >= 99);
  assert.equal(res.latitude, 26.66612);
  assert.equal(res.longitude, 80.94621);
  assert.ok(!('distanceMeters' in res));
  assert.ok(!('geofenceVerified' in res));

  const extractedMs = parseSiteTimestampMs(undefined, res.verificationId);
  assert.ok(extractedMs >= beforeMs && extractedMs <= afterMs);
});

test('verifyRegisteredFingerprintLock enforces strict 1-to-1 matching and rejects unregistered devices', async () => {
  const { verifyRegisteredFingerprintLock } = await import('./facial-verification.ts');

  // 1. First-time registration when no credential is enrolled yet
  const firstScan = verifyRegisteredFingerprintLock(null, 'PASSKEY-PIYUSH-PHONE-01', 'piyush');
  assert.equal(firstScan.verified, true);
  assert.equal(firstScan.isFirstTimeEnrollment, true);

  // 2. Subsequent scan from the exact same registered phone/fingerprint -> Verified!
  const samePhoneScan = verifyRegisteredFingerprintLock(
    'PASSKEY-PIYUSH-PHONE-01',
    'PASSKEY-PIYUSH-PHONE-01',
    'piyush',
  );
  assert.equal(samePhoneScan.verified, true);
  assert.equal(samePhoneScan.isFirstTimeEnrollment, false);

  // 3. Scan from a different person/phone with a different credential -> Strictly Rejected!
  const differentPhoneScan = verifyRegisteredFingerprintLock(
    'PASSKEY-PIYUSH-PHONE-01',
    'PASSKEY-OTHER-PERSON-99',
    'piyush',
  );
  assert.equal(differentPhoneScan.verified, false);
  assert.ok(differentPhoneScan.error?.includes('Fingerprint Mismatch Denied'));

  // 4. Pre-enrolled active profile (FP-BOUND-*) seamlessly verifies & binds without Setup Mode
  const preBoundScan = verifyRegisteredFingerprintLock(
    'FP-BOUND-RAHUL-ACTIVE',
    'PASSKEY-RAHUL-PHONE-01',
    'rahul',
  );
  assert.equal(preBoundScan.verified, true);
  assert.equal(preBoundScan.isFirstTimeEnrollment, false);
});
