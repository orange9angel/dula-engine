/**
 * Maps TTS/voice emotions (from generate_audio.py) to facial-expression
 * animation names. Used by Storyboard to auto-play a face animation when a
 * dialogue entry does not already contain an explicit {Face...} tag.
 *
 * Emotion names are those produced by generate_audio.py/infer_emotion().
 */

export const FACE_EMOTION_MAP = {
  // Positive / energetic
  happy: 'FaceHappy',
  excited: 'FaceHappy',
  triumphant: 'FaceHappy',
  proud: 'FaceProud',
  teasing: 'FaceGrin',

  // Negative / intense
  sad: 'FaceSad',
  cry: 'FaceCry',
  scared: 'FaceScared',
  panic: 'FaceScared',
  worried: 'FaceWorried',
  concerned: 'FaceWorried',
  angry: 'FaceAngry',
  defiant: 'FaceAngry',
  exasperated: 'FaceAngry',

  // Surprise / confusion
  amazed: 'FaceSurprised',
  surprised: 'FaceSurprised',
  confused: 'FaceConfused',
  curious: 'FaceConfused',

  // Relaxed / neutral-positive
  calm: 'FaceRelaxed',
  gentle: 'FaceRelaxed',
  relaxed: 'FaceRelaxed',
  determined: 'FaceDetermined',
  pain: 'FacePain',
  smirk: 'FaceSmirk',
};

/**
 * Return the best Face animation name for a given emotion string.
 * Falls back to null so the caller can decide whether to play a default.
 */
export function faceAnimationForEmotion(emotion) {
  if (!emotion) return null;
  const key = emotion.toLowerCase().trim();
  return FACE_EMOTION_MAP[key] || null;
}
