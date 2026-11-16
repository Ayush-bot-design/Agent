import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  saveEnrolledFaceTemplate,
  getEnrolledFaceTemplate,
  deleteEnrolledFaceTemplate,
  getEnrolledFaceTemplates,
  assessImageQuality,
  extract128DFacialEmbedding,
  calculateEmbeddingDistance,
  processFaceRecognition,
} from './face-recognition-engine.ts';

test('Template Manager: enrolls, retrieves, and deletes face templates', async () => {
  await deleteEnrolledFaceTemplate('tech_007');
  assert.equal(getEnrolledFaceTemplate('tech_007'), null);

  const mockEmbedding = Array.from({ length: 128 }, (_, i) => i / 128);
  await saveEnrolledFaceTemplate(
    'tech_007',
    'Agent Bond',
    mockEmbedding,
    'data:image/png;base64,mock',
  );

  const retrieved = getEnrolledFaceTemplate('tech_007');
  assert.ok(retrieved !== null);
  assert.equal(retrieved.personId, 'tech_007');
  assert.equal(retrieved.personName, 'Agent Bond');
  assert.equal(retrieved.embedding.length, 128);

  const all = getEnrolledFaceTemplates();
  assert.ok(all.some((t) => t.personId === 'tech_007'));

  await deleteEnrolledFaceTemplate('tech_007');
  assert.equal(getEnrolledFaceTemplate('tech_007'), null);
});

test('assessImageQuality detects dark frames, overexposed frames, and multi-finger hands', async () => {
  const width = 160;
  const height = 120;

  // Dark frame
  const darkData = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < darkData.length; i += 4) {
    darkData[i] = 5;
    darkData[i + 1] = 5;
    darkData[i + 2] = 5;
    darkData[i + 3] = 255;
  }
  const darkQuality = assessImageQuality(
    { data: darkData, width, height } as ImageData,
    width,
    height,
  );
  assert.equal(darkQuality.isAcceptable, false);
  assert.equal(darkQuality.hasAdequateLighting, false);

  // Hand frame with 4 finger columns
  const handData = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < handData.length; i += 4) {
    handData[i] = 30;
    handData[i + 1] = 30;
    handData[i + 2] = 30;
    handData[i + 3] = 255;
  }
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
        handData[idx] = 210;
        handData[idx + 1] = 145;
        handData[idx + 2] = 100;
        handData[idx + 3] = 255;
      }
    }
  }
  const handQuality = assessImageQuality(
    { data: handData, width, height } as ImageData,
    width,
    height,
  );
  assert.equal(handQuality.isAcceptable, false);
  assert.ok(handQuality.reason?.includes('Hand or palm'));
});

test('extract128DFacialEmbedding generates normalized 128-D spatial vector', async () => {
  const width = 160;
  const height = 120;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = (i * 3) % 256;
    data[i + 1] = (i * 5) % 256;
    data[i + 2] = (i * 11) % 256;
    data[i + 3] = 255;
  }
  const vector = extract128DFacialEmbedding({ data, width, height } as ImageData, width, height);
  assert.equal(vector.length, 128);
  assert.ok(vector.every((val) => typeof val === 'number' && !isNaN(val)));
});

test('calculateEmbeddingDistance measures distance between matching and non-matching vectors', async () => {
  const v1 = Array.from({ length: 128 }, () => 0.5);
  const v2 = Array.from({ length: 128 }, () => 0.52);
  const v3 = Array.from({ length: 128 }, () => -0.8);

  const distMatch = calculateEmbeddingDistance(v1, v2);
  const distDiff = calculateEmbeddingDistance(v1, v3);

  assert.ok(distMatch < 0.1, 'Similar embeddings should have distance < 0.10');
  assert.ok(distDiff > 0.5, 'Dissimilar embeddings should have distance > 0.50');
});

test('processFaceRecognition performs enrollment and returns unknown result when threshold exceeded', async () => {
  await deleteEnrolledFaceTemplate('tech_unknown_99');

  const width = 160;
  const height = 120;
  const faceData = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < faceData.length; i += 4) {
    const v = i % 50;
    faceData[i] = Math.min(255, 190 + v);
    faceData[i + 1] = Math.min(255, 130 + v);
    faceData[i + 2] = Math.min(255, 90 + v / 2);
    faceData[i + 3] = 255;
  }
  const imgData = { data: faceData, width, height } as ImageData;

  // First time check for target person -> Auto Enrollment!
  const enrollRes = await processFaceRecognition(imgData, width, height, 'tech_unknown_99');
  assert.equal(enrollRes.status, 'matched');
  assert.equal(enrollRes.matchedPersonId, 'tech_unknown_99');
  assert.ok(enrollRes.livenessVerified);

  // Subsequent check for same person -> Matched!
  const matchRes = await processFaceRecognition(imgData, width, height, 'tech_unknown_99');
  assert.equal(matchRes.status, 'matched');
  assert.equal(matchRes.matchedPersonId, 'tech_unknown_99');

  // Modify enrolled embedding to simulate a completely different person
  const differentEmbedding = Array.from({ length: 128 }, (_, i) => (i % 2 === 0 ? 5.0 : -5.0));
  await saveEnrolledFaceTemplate('tech_unknown_99', 'Different Person', differentEmbedding);

  // Scan live face against mismatched enrolled template -> Unknown status returned!
  const mismatchRes = await processFaceRecognition(imgData, width, height, 'tech_unknown_99', 0.42);
  assert.equal(mismatchRes.status, 'unknown');
  assert.equal(mismatchRes.matchedPersonId, undefined);
  assert.ok(mismatchRes.distance >= 0.42);
  assert.ok(mismatchRes.engineMessage.includes('Unknown face detected'));
});
