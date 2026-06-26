import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AccessToken, RoomServiceClient, AgentDispatchClient } from 'livekit-server-sdk';
import { requireAuth, requireModuleAccess } from '../aptitude/middleware/auth.js';
import { HttpError, asyncHandler } from '../utils/httpError.js';
import { nimService } from '../services/nimService.js';
import { aiService } from '../services/aiService.js';
import { config } from '../config.js';

const commAi = config.nvidiaApiKey ? nimService : aiService;
const router = Router();

const livekitHttpUrl = config.livekitUrl
  .replace('ws://', 'http://')
  .replace('wss://', 'https://');

const roomClient = new RoomServiceClient(
  livekitHttpUrl,
  config.livekitApiKey,
  config.livekitApiSecret,
);

const dispatchClient = new AgentDispatchClient(
  livekitHttpUrl,
  config.livekitApiKey,
  config.livekitApiSecret,
);

router.post('/rejoin-room', requireAuth, requireModuleAccess('communication'), asyncHandler(async (req, res) => {
  const { room } = req.body || {};
  if (!room) throw new HttpError(400, 'room is required');

  const rooms = await roomClient.listRooms([room]);
  if (!rooms.length) throw new HttpError(404, 'Room not found');

  const token = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
    identity: req.user._id,
    name: req.user.name || 'Student',
  });
  token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
  const jwt = await token.toJwt();

  res.json({ room, token: jwt });
}));

router.post('/create-room', requireAuth, requireModuleAccess('communication'), asyncHandler(async (req, res) => {
  const { category } = req.body || {};
  const roomName = `interview-${uuidv4().slice(0, 8)}`;

  await roomClient.createRoom({ name: roomName, emptyTimeout: 300 });

  const participantToken = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
    identity: req.user._id,
    name: req.user.name || 'Student',
  });
  participantToken.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
  const token = await participantToken.toJwt();

  // Dispatch the interview-agent to the room
  dispatchClient.createDispatch(roomName, 'interview-agent', {
    metadata: JSON.stringify({
      category: category || 'Tell Me About Yourself',
      userIdentity: req.user._id,
    }),
  }).catch((err) => {
    console.error('Failed to dispatch agent:', err.message);
  });

  res.json({
    room: roomName,
    token,
    category: category || 'Tell Me About Yourself',
  });
}));

router.post('/generate-scenario', asyncHandler(async (req, res) => {
  const { category } = req.body || {};
  const scenario = await commAi.generateScenario(category || 'Tell Me About Yourself');
  res.json({ opening: scenario.opening });
}));

router.post('/evaluate', asyncHandler(async (req, res) => {
  const { session_id, transcript, category, exchange_count, current_prompt } = req.body || {};
  if (!transcript) throw new HttpError(400, 'transcript is required');

  let prompt = current_prompt || '';
  if (!prompt && exchange_count === 0) {
    const scenario = await commAi.generateScenario(category || 'Tell Me About Yourself');
    prompt = scenario.opening;
  }

  const evaluation = await commAi.evaluateResponse(prompt, transcript);
  const next_exchange = exchange_count + 1;
  const is_last = next_exchange >= 6;
  const next_prompt = is_last ? '' : (evaluation.next_prompt || 'Can you tell me more about a specific example from your experience?');

  res.json({
    exchange_number: next_exchange,
    evaluation: {
      clarity: evaluation.clarity,
      structure: evaluation.structure,
      conciseness: evaluation.conciseness,
      relevance: evaluation.relevance,
      confidence_tone: evaluation.confidence_tone,
    },
    feedback: evaluation.feedback,
    strengths: evaluation.strengths || [],
    improvements: evaluation.improvements || [],
    next_prompt,
    is_last,
  });
}));

router.post('/end-room', requireAuth, requireModuleAccess('communication'), asyncHandler(async (req, res) => {
  const { room } = req.body || {};
  if (!room) throw new HttpError(400, 'room is required');
  await roomClient.deleteRoom(room);
  res.json({ success: true });
}));

export default router;
