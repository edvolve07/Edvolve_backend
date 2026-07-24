import { Router } from 'express';
import { Op } from 'sequelize';
import { requireAuth, requireModuleAccess, requireRole } from '../../aptitude/middleware/auth.js';
import { HttpError, asyncHandler } from '../../utils/httpError.js';
import { CommunicationScenario } from '../../database/models/CommunicationScenario.js';
import { CommunicationReport } from '../../database/models/CommunicationReport.js';
import { User } from '../../database/index.js';
import { buildStudentFilter } from '../../aptitude/utils/adminScope.js';
import { ROLES } from '../../aptitude/utils/roles.js';

const router = Router();

router.use(requireAuth, requireRole(ROLES.ADMIN, ROLES.MASTER_ADMIN), requireModuleAccess('communication'));

router.post('/scenarios', asyncHandler(async (req, res) => {
  const { title, description, category, context, difficulty, status } = req.body || {};
  if (!title) throw new HttpError(400, 'title is required');

  const scenario = await CommunicationScenario.create({
    title,
    description: description || '',
    category: category || '',
    context: context || '',
    difficulty: difficulty || 'Medium',
    status: status || 'draft',
    created_by: req.user._id,
  });
  res.json({ scenario });
}));

router.get('/scenarios', asyncHandler(async (req, res) => {
  const scenarios = await CommunicationScenario.findAll({
    order: [['created_at', 'DESC']],
  });
  res.json({ scenarios });
}));

router.put('/scenarios/:id', asyncHandler(async (req, res) => {
  const scenario = await CommunicationScenario.findByPk(req.params.id);
  if (!scenario) throw new HttpError(404, 'Scenario not found');
  const { title, description, category, context, difficulty, status } = req.body || {};
  await scenario.update({
    ...(title !== undefined && { title }),
    ...(description !== undefined && { description }),
    ...(category !== undefined && { category }),
    ...(context !== undefined && { context }),
    ...(difficulty !== undefined && { difficulty }),
    ...(status !== undefined && { status }),
  });
  res.json({ scenario });
}));

router.delete('/scenarios/:id', asyncHandler(async (req, res) => {
  const scenario = await CommunicationScenario.findByPk(req.params.id);
  if (!scenario) throw new HttpError(404, 'Scenario not found');
  await scenario.destroy();
  res.json({ deleted: true });
}));

router.get('/analytics', asyncHandler(async (req, res) => {
  const { filter } = await buildStudentFilter(req.user);

  const reports = await CommunicationReport.findAll({
    where: filter || {},
    attributes: [
      'session_id', 'report_id', 'generated_date', 'student_id',
      'student_name', 'student_email', 'category', 'overall', 'created_at',
    ],
    order: [['created_at', 'DESC']],
    limit: 500,
  });

  const mapped = reports.map((r) => ({
    session_id: r.session_id,
    report_id: r.report_id,
    student_id: r.student_id || '',
    student_name: r.student_name || '',
    student_email: r.student_email || '',
    category: r.category || '',
    generated_date: r.generated_date,
    percentage: r.overall?.percentage || 0,
    grade: r.overall?.grade || '',
    grade_label: r.overall?.grade_label || '',
    created_at: r.created_at,
  }));

  const percentages = mapped.map((r) => Number(r.percentage || 0)).filter(Number.isFinite);

  res.json({
    reports: mapped,
    total_reports: mapped.length,
    average_percentage: percentages.length
      ? Number((percentages.reduce((s, v) => s + v, 0) / percentages.length).toFixed(2))
      : 0,
  });
}));

export default router;
