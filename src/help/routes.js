import { Router } from 'express';
import { requireAuth, requireRole } from '../aptitude/middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { HelpRequest, Institution, User } from '../database/index.js';

const router = Router();

function serialize(req) {
  return {
    _id: req._id,
    name: req.name,
    email: req.email,
    phone: req.phone || '',
    institution: req.institution || '',
    issue: req.issue,
    status: req.status,
    created_at: req.created_at,
    updated_at: req.updated_at,
    response: req.response || null,
    responded_by: req.responded_by || null,
    responded_at: req.responded_at || null,
  };
}

// GET /api/help — master admin sees all requests
router.get(
  '/',
  requireAuth,
  requireRole('master_admin'),
  asyncHandler(async (_req, res) => {
    const requests = await HelpRequest.findAll({
      order: [['created_at', 'DESC']],
    });
    res.json(requests.map(serialize));
  }),
);

// GET /api/help/my — current user's own requests
router.get(
  '/my',
  requireAuth,
  asyncHandler(async (req, res) => {
    const requests = await HelpRequest.findAll({
      where: { user_id: req.user._id },
      order: [['created_at', 'DESC']],
    });
    res.json(requests.map(serialize));
  }),
);

// POST /api/help — submit a new help request
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { name, email, phone, institution, issue } = req.body || {};

    if (!name || !String(name).trim()) {
      throw new HttpError(400, 'Name is required');
    }
    if (!email || !String(email).trim()) {
      throw new HttpError(400, 'Email is required');
    }
    if (!issue || !String(issue).trim()) {
      throw new HttpError(400, 'Issue description is required');
    }

    // Resolve institution name: if user has institutionId, look it up
    let institutionName = String(institution || '').trim();
    if (!institutionName && req.user.institutionId) {
      const inst = await Institution.findByPk(req.user.institutionId);
      if (inst) institutionName = inst.name;
    }

    const created = await HelpRequest.create({
      user_id: req.user._id,
      name: String(name).trim(),
      email: String(email).trim(),
      phone: String(phone || '').trim(),
      institution: institutionName,
      issue: String(issue).trim(),
      status: 'open',
    });

    res.status(201).json({ request: serialize(created) });
  }),
);

// PATCH /api/help/:id — master admin responds / updates status
router.patch(
  '/:id',
  requireAuth,
  requireRole('master_admin'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { status, response } = req.body || {};

    const helpReq = await HelpRequest.findByPk(id);
    if (!helpReq) {
      throw new HttpError(404, 'Help request not found');
    }

    if (status) {
      const validStatuses = ['open', 'in_progress', 'resolved', 'closed'];
      if (!validStatuses.includes(status)) {
        throw new HttpError(400, `Invalid status. Must be one of: ${validStatuses.join(', ')}`);
      }
      helpReq.status = status;
    }

    if (response !== undefined) {
      helpReq.response = String(response).trim() || null;
      helpReq.responded_by = req.user.name || req.user.email || 'Admin';
      helpReq.responded_at = new Date();
    }

    await helpReq.save();

    res.json({ request: serialize(helpReq) });
  }),
);

export default router;
