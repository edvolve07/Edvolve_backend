import { Router } from 'express';
import { requireAuth, requireRole } from '../aptitude/middleware/auth.js';
import { asyncHandler, HttpError } from '../utils/httpError.js';
import { getSequelize } from '../database/connection.js';
import { Subscription, PaymentTransaction, StudentJourney, User, Plan } from '../database/index.js';
import { config } from '../config.js';

const router = Router();

const PLANS = {
  basic: {
    key: 'basic',
    name: 'Basic',
    access_level: 1,
    interviews_total: 4,
    amount: 199,
    gst_rate: 0.18,
    features: ['Level 1 Journey Access', '4 AI Interviews', 'Resume Builder', 'Reports & Analytics'],
  },
  advanced: {
    key: 'advanced',
    name: 'Advanced',
    access_level: 3,
    interviews_total: 12,
    amount: 499,
    gst_rate: 0.18,
    features: ['Levels 1-3 Journey Access', '12 AI Interviews', 'Resume Builder', 'Reports & Analytics', 'Programming Practice', 'Communication Skills'],
  },
  professional: {
    key: 'professional',
    name: 'Professional',
    access_level: 6,
    interviews_total: 24,
    amount: 849,
    gst_rate: 0.18,
    features: ['All 6 Levels Journey Access', '24 AI Interviews', 'Resume Builder', 'Reports & Analytics', 'Programming Practice', 'Communication Skills', 'Certificates', 'Priority Support'],
  },
};

function getRazorpayClient() {
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) {
    if (config.isProduction) return null;
    return null;
  }
  return { key_id, key_secret };
}

function generateInvoiceNumber() {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const rand = String(Math.floor(Math.random() * 9999)).padStart(4, '0');
  return `INV-${ym}-${rand}`;
}

router.get('/plans', requireAuth, asyncHandler(async (req, res) => {
  const plans = Object.values(PLANS).map(p => ({
    key: p.key,
    name: p.name,
    access_level: p.access_level,
    interviews_total: p.interviews_total,
    amount: p.amount,
    gst_amount: Math.round(p.amount * p.gst_rate),
    total_amount: p.amount + Math.round(p.amount * p.gst_rate),
    features: p.features,
  }));
  res.json({ plans });
}));

router.post('/create-order', requireAuth, requireRole('individual_student'), asyncHandler(async (req, res) => {
  const { plan_key } = req.body || {};
  if (!plan_key || !PLANS[plan_key]) throw new HttpError(400, 'Invalid plan key');

  const plan = PLANS[plan_key];
  const totalAmount = plan.amount + Math.round(plan.amount * plan.gst_rate);

  const razorpay = getRazorpayClient();
  if (!razorpay) {
    if (config.isProduction) throw new HttpError(500, 'Payment gateway not configured');
    return res.json({
      order_id: `mock_order_${Date.now()}`,
      amount: totalAmount,
      currency: 'INR',
      key_id: 'rzp_test_mock',
      mock: true,
    });
  }

  const auth = Buffer.from(`${razorpay.key_id}:${razorpay.key_secret}`).toString('base64');
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: totalAmount * 100,
      currency: 'INR',
      receipt: `rcpt_${req.user._id.slice(0,8)}_${plan_key}_${Date.now().toString(36)}`,
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new HttpError(500, err.error?.description || 'Failed to create payment order');
  }

  const order = await response.json();
  res.json({
    order_id: order.id,
    amount: totalAmount,
    currency: 'INR',
    key_id: razorpay.key_id,
    mock: false,
  });
}));

router.post('/verify', requireAuth, requireRole('individual_student'), asyncHandler(async (req, res) => {
  const { plan_key, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!plan_key || !PLANS[plan_key]) throw new HttpError(400, 'Invalid plan key');

  const plan = PLANS[plan_key];
  const studentId = req.user._id;
  const totalAmount = plan.amount + Math.round(plan.amount * plan.gst_rate);

  const razorpay = getRazorpayClient();
  if (razorpay && razorpay_order_id && razorpay_payment_id && razorpay_signature) {
    const crypto = await import('node:crypto');
    const expectedSig = crypto.createHmac('sha256', razorpay.key_secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');
    if (expectedSig !== razorpay_signature) {
      throw new HttpError(400, 'Payment verification failed');
    }
  }

  const invoiceNumber = generateInvoiceNumber();
  const gstAmount = Math.round(plan.amount * plan.gst_rate);

  const planRecord = await Plan.findOne({ where: { plan_key: plan.key } });

  const subscription = await Subscription.create({
    student_id: studentId,
    plan_key: plan.key,
    plan_name: plan.name,
    plan_id: planRecord?._id || null,
    access_level: plan.access_level,
    interviews_total: plan.interviews_total,
    status: 'active',
    razorpay_order_id: razorpay_order_id || null,
    razorpay_payment_id: razorpay_payment_id || null,
    amount_paid: plan.amount,
    currency: 'INR',
    gst_amount: gstAmount,
    start_date: new Date(),
    end_date: null,
    invoices: [{
      number: invoiceNumber,
      date: new Date().toISOString(),
      amount: plan.amount,
      gst: gstAmount,
      total: totalAmount,
    }],
  });

  const transaction = await PaymentTransaction.create({
    student_id: studentId,
    subscription_id: subscription._id,
    amount: plan.amount,
    currency: 'INR',
    gst_amount: gstAmount,
    total_amount: totalAmount,
    payment_method: 'razorpay',
    payment_id: razorpay_payment_id || null,
    order_id: razorpay_order_id || null,
    status: 'completed',
    invoice_number: invoiceNumber,
    invoice_date: new Date(),
    invoice_items: [
      { description: `${plan.name} Plan - Journey Access`, amount: plan.amount, gst: gstAmount, total: totalAmount },
    ],
    plan_key: plan.key,
    plan_name: plan.name,
  });

  const existingJourney = await StudentJourney.findOne({ where: { student_id: studentId } });
  if (!existingJourney) {
    const student = await User.findOne({ where: { _id: studentId } });
    await StudentJourney.create({
      student_id: studentId,
      student_name: student?.name || '',
      student_email: student?.email || '',
      institution_id: null,
      journey_access_level: plan.access_level,
      current_level: 1,
      status: 'not_started',
    });
  } else {
    await existingJourney.update({ journey_access_level: plan.access_level });
  }

  res.json({
    success: true,
    subscription: {
      id: subscription._id,
      plan_key: subscription.plan_key,
      plan_name: subscription.plan_name,
      access_level: subscription.access_level,
      interviews_total: subscription.interviews_total,
      status: subscription.status,
      amount_paid: subscription.amount_paid,
      gst_amount: subscription.gst_amount,
    },
    invoice: { number: invoiceNumber, amount: plan.amount, gst: gstAmount, total: totalAmount },
    transaction_id: transaction._id,
  });
}));

router.post(
  '/verify-upgrade',
  requireAuth,
  requireRole('individual_student'),
  asyncHandler(async (req, res) => {
    const { plan_key, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

    if (!plan_key || !plan_key.startsWith('level_upgrade_')) {
      throw new HttpError(400, 'Invalid upgrade plan key');
    }

    const targetLevel = parseInt(plan_key.replace('level_upgrade_', ''), 10);
    if (!targetLevel || targetLevel < 1 || targetLevel > 6) {
      throw new HttpError(400, 'Invalid target level');
    }

    const currentSub = await Subscription.findOne({
      where: { student_id: req.user._id, status: 'active' },
      order: [['created_at', 'DESC']],
    });

    const currentLevel = currentSub ? currentSub.access_level : 0;
    if (targetLevel <= currentLevel) {
      throw new HttpError(400, 'Target level must be higher than current level');
    }

    const preview = calculateLevelUpgrade(currentLevel, targetLevel);
    const studentId = req.user._id;

    const razorpay = getRazorpayClient();
    if (razorpay && razorpay_order_id && razorpay_payment_id && razorpay_signature) {
      const crypto = await import('node:crypto');
      const expectedSig = crypto.createHmac('sha256', razorpay.key_secret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');
      if (expectedSig !== razorpay_signature) {
        throw new HttpError(400, 'Payment verification failed');
      }
    }

    const invoiceNumber = generateInvoiceNumber();

    if (currentSub) {
      await currentSub.update({ status: 'upgraded' });
    }

    const levelName = `Level ${currentLevel + 1}${targetLevel > currentLevel + 1 ? `\u2013${targetLevel}` : ''}`;

    const newSub = await Subscription.create({
      student_id: studentId,
      plan_key: `level_upgrade_${targetLevel}`,
      plan_name: `Level Upgrade to ${targetLevel}`,
      access_level: targetLevel,
      interviews_total: targetLevel * 4,
      status: 'active',
      razorpay_order_id: razorpay_order_id || null,
      razorpay_payment_id: razorpay_payment_id || null,
      amount_paid: preview.final_price,
      currency: 'INR',
      gst_amount: preview.gst_amount,
      start_date: new Date(),
      end_date: null,
      invoices: [{
        number: invoiceNumber,
        date: new Date().toISOString(),
        amount: preview.final_price,
        gst: preview.gst_amount,
        total: preview.total_amount,
      }],
    });

    await PaymentTransaction.create({
      student_id: studentId,
      subscription_id: newSub._id,
      amount: preview.final_price,
      currency: 'INR',
      gst_amount: preview.gst_amount,
      total_amount: preview.total_amount,
      payment_method: 'razorpay',
      payment_id: razorpay_payment_id || null,
      order_id: razorpay_order_id || null,
      status: 'completed',
      invoice_number: invoiceNumber,
      invoice_date: new Date(),
      invoice_items: [{
        description: `Level Upgrade: ${levelName}${preview.has_discount ? ' (25% bulk discount applied)' : ''}`,
        amount: preview.final_price,
        gst: preview.gst_amount,
        total: preview.total_amount,
      }],
      plan_key: `level_upgrade_${targetLevel}`,
      plan_name: `Level Upgrade to ${targetLevel}`,
    });

    const journey = await StudentJourney.findOne({ where: { student_id: studentId } });
    if (journey) {
      await journey.update({ journey_access_level: targetLevel });
    } else {
      const student = await User.findOne({ where: { _id: studentId } });
      await StudentJourney.create({
        student_id: studentId,
        student_name: student?.name || '',
        student_email: student?.email || '',
        institution_id: null,
        journey_access_level: targetLevel,
        current_level: 1,
        status: 'not_started',
      });
    }

    res.json({
      success: true,
      subscription: {
        id: newSub._id,
        plan_key: newSub.plan_key,
        plan_name: newSub.plan_name,
        access_level: newSub.access_level,
        interviews_total: newSub.interviews_total,
        status: newSub.status,
        amount_paid: newSub.amount_paid,
        gst_amount: newSub.gst_amount,
      },
      invoice: { number: invoiceNumber, amount: preview.final_price, gst: preview.gst_amount, total: preview.total_amount },
    });
  }),
);

router.get('/current', requireAuth, requireRole('individual_student'), asyncHandler(async (req, res) => {
  const subscription = await Subscription.findOne({
    where: { student_id: req.user._id, status: 'active' },
    order: [['created_at', 'DESC']],
  });

  if (!subscription) {
    return res.json({ subscription: null });
  }

  const journey = await StudentJourney.findOne({ where: { student_id: req.user._id } });

  res.json({
    subscription: {
      id: subscription._id,
      plan_key: subscription.plan_key,
      plan_name: subscription.plan_name,
      access_level: subscription.access_level,
      interviews_total: subscription.interviews_total,
      status: subscription.status,
      amount_paid: subscription.amount_paid,
      gst_amount: subscription.gst_amount,
      start_date: subscription.start_date,
      end_date: subscription.end_date,
      created_at: subscription.created_at,
    },
    journey: journey ? {
      current_level: journey.current_level,
      completed_interviews: journey.completed_interviews,
      readiness_score: journey.readiness_score,
      status: journey.status,
    } : null,
  });
}));

router.get('/history', requireAuth, requireRole('individual_student'), asyncHandler(async (req, res) => {
  const transactions = await PaymentTransaction.findAll({
    where: { student_id: req.user._id },
    order: [['created_at', 'DESC']],
  });

  res.json({
    transactions: transactions.map(t => ({
      id: t._id,
      amount: t.amount,
      gst_amount: t.gst_amount,
      total_amount: t.total_amount,
      status: t.status,
      invoice_number: t.invoice_number,
      invoice_date: t.invoice_date,
      plan_key: t.plan_key,
      plan_name: t.plan_name,
      created_at: t.created_at,
    })),
  });
}));

router.get('/invoice/:transactionId', requireAuth, requireRole('individual_student'), asyncHandler(async (req, res) => {
  const transaction = await PaymentTransaction.findOne({
    where: { _id: req.params.transactionId, student_id: req.user._id },
  });
  if (!transaction) throw new HttpError(404, 'Transaction not found');

  const student = await User.findOne({ where: { _id: req.user._id } });

  res.json({
    invoice: {
      number: transaction.invoice_number,
      date: transaction.invoice_date,
      student: {
        name: student?.name,
        email: student?.email,
      },
      items: transaction.invoice_items,
      subtotal: transaction.amount,
      gst: transaction.gst_amount,
      total: transaction.total_amount,
      payment_method: transaction.payment_method,
      payment_id: transaction.payment_id,
      plan_name: transaction.plan_name,
    },
  });
}));

const LEVEL_PRICE = 199;
const BULK_DISCOUNT_LEVELS = 2;
const BULK_DISCOUNT_RATE = 0.25;
const GST_RATE = 0.18;

function calculateLevelUpgrade(currentLevel, targetLevel, gstRate = GST_RATE) {
  if (targetLevel <= currentLevel) return null;
  const levelsCount = targetLevel - currentLevel;
  const basePrice = levelsCount * LEVEL_PRICE;
  const hasDiscount = levelsCount >= BULK_DISCOUNT_LEVELS;
  const discountAmount = hasDiscount ? Math.round(basePrice * BULK_DISCOUNT_RATE) : 0;
  const finalPrice = basePrice - discountAmount;
  const gstAmount = Math.round(finalPrice * gstRate);
  const totalAmount = finalPrice + gstAmount;
  return {
    levels_count: levelsCount,
    current_level: currentLevel,
    target_level: targetLevel,
    price_per_level: LEVEL_PRICE,
    base_price: basePrice,
    has_discount: hasDiscount,
    discount_percentage: hasDiscount ? 25 : 0,
    discount_amount: discountAmount,
    final_price: finalPrice,
    gst_amount: gstAmount,
    total_amount: totalAmount,
  };
}

router.get('/upgrade-preview', requireAuth, requireRole('individual_student'), asyncHandler(async (req, res) => {
  const { target_level } = req.query;
  const target = parseInt(target_level);
  if (!target || target < 1 || target > 6) throw new HttpError(400, 'Target level must be 1-6');

  const currentSub = await Subscription.findOne({
    where: { student_id: req.user._id, status: 'active' },
    order: [['created_at', 'DESC']],
  });

  const currentLevel = currentSub ? currentSub.access_level : 0;
  if (target <= currentLevel) throw new HttpError(400, 'Target level must be higher than current level');

  const preview = calculateLevelUpgrade(currentLevel, target);
  res.json({ preview });
}));

router.post(
  "/create-upgrade-order",
  requireAuth,
  requireRole("individual_student"),
  asyncHandler(async (req, res) => {
    const { target_level } = req.body || {};
    const target = parseInt(target_level);
    if (!target || target < 1 || target > 6) throw new HttpError(400, "Target level must be 1-6");

    const currentSub = await Subscription.findOne({
      where: { student_id: req.user._id, status: "active" },
      order: [["created_at", "DESC"]],
    });

    const currentLevel = currentSub ? currentSub.access_level : 0;
    if (target <= currentLevel) throw new HttpError(400, "Target level must be higher than current level");

    const preview = calculateLevelUpgrade(currentLevel, target);
    const totalAmount = preview.total_amount;

    const razorpay = getRazorpayClient();
    if (!razorpay) {
      if (config.isProduction) throw new HttpError(500, 'Payment gateway not configured');
      return res.json({
        order_id: `mock_order_${Date.now()}`,
        amount: totalAmount,
        currency: "INR",
        key_id: "rzp_test_mock",
        mock: true,
      });
    }

    const auth = Buffer.from(`${razorpay.key_id}:${razorpay.key_secret}`).toString("base64");
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: totalAmount * 100,
        currency: "INR",
        receipt: `rcpt_${req.user._id.slice(0,8)}_upg${target}_${Date.now().toString(36)}`,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new HttpError(500, err.error?.description || "Failed to create payment order");
    }

    const order = await response.json();
    res.json({
      order_id: order.id,
      amount: totalAmount,
      currency: "INR",
      key_id: razorpay.key_id,
      mock: false,
    });
  }),
);

router.post('/upgrade-level', requireAuth, requireRole('individual_student'), asyncHandler(async (req, res) => {
  const { target_level, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  const target = parseInt(target_level);
  if (!target || target < 1 || target > 6) throw new HttpError(400, 'Target level must be 1-6');

  const currentSub = await Subscription.findOne({
    where: { student_id: req.user._id, status: 'active' },
    order: [['created_at', 'DESC']],
  });

  const currentLevel = currentSub ? currentSub.access_level : 0;
  if (target <= currentLevel) throw new HttpError(400, 'Target level must be higher than current level');

  const razorpay = getRazorpayClient();
  if (razorpay && razorpay_order_id && razorpay_payment_id && razorpay_signature) {
    const crypto = await import('node:crypto');
    const expectedSig = crypto.createHmac('sha256', razorpay.key_secret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');
    if (expectedSig !== razorpay_signature) {
      throw new HttpError(400, 'Payment verification failed');
    }
  }

  const preview = calculateLevelUpgrade(currentLevel, target);
  const studentId = req.user._id;

  if (currentSub) {
    await currentSub.update({ status: 'upgraded' });
  }

  const invoiceNumber = generateInvoiceNumber();
  const levelName = `Level ${currentLevel + 1}${target > currentLevel + 1 ? `–${target}` : ''}`;

  const newSub = await Subscription.create({
    student_id: studentId,
    plan_key: `level_upgrade_${target}`,
    plan_name: `Level Upgrade to ${target}`,
    access_level: target,
    interviews_total: target * 4,
    status: 'active',
    razorpay_order_id: razorpay_order_id || null,
    razorpay_payment_id: razorpay_payment_id || null,
    amount_paid: preview.final_price,
    currency: 'INR',
    gst_amount: preview.gst_amount,
    start_date: new Date(),
    end_date: null,
    invoices: [{
      number: invoiceNumber,
      date: new Date().toISOString(),
      amount: preview.final_price,
      gst: preview.gst_amount,
      total: preview.total_amount,
    }],
  });

  await PaymentTransaction.create({
    student_id: studentId,
    subscription_id: newSub._id,
    amount: preview.final_price,
    currency: 'INR',
    gst_amount: preview.gst_amount,
    total_amount: preview.total_amount,
    payment_method: 'razorpay',
    payment_id: razorpay_payment_id || null,
    order_id: razorpay_order_id || null,
    status: 'completed',
    invoice_number: invoiceNumber,
    invoice_date: new Date(),
    invoice_items: [
      {
        description: `Level Upgrade: ${levelName}${preview.has_discount ? ` (25% bulk discount applied)` : ''}`,
        amount: preview.final_price,
        gst: preview.gst_amount,
        total: preview.total_amount,
      },
    ],
    plan_key: `level_upgrade_${target}`,
    plan_name: `Level Upgrade to ${target}`,
  });

  const journey = await StudentJourney.findOne({ where: { student_id: studentId } });
  if (journey) {
    await journey.update({ journey_access_level: target });
  } else {
    const student = await User.findOne({ where: { _id: studentId } });
    await StudentJourney.create({
      student_id: studentId,
      student_name: student?.name || '',
      student_email: student?.email || '',
      institution_id: null,
      journey_access_level: target,
      current_level: 1,
      status: 'not_started',
    });
  }

  res.json({
    success: true,
    subscription: {
      id: newSub._id,
      plan_key: newSub.plan_key,
      plan_name: newSub.plan_name,
      access_level: newSub.access_level,
      interviews_total: newSub.interviews_total,
      status: newSub.status,
      amount_paid: newSub.amount_paid,
      gst_amount: newSub.gst_amount,
    },
    invoice: { number: invoiceNumber, amount: preview.final_price, gst: preview.gst_amount, total: preview.total_amount },
    upgrade: preview,
  });
}));

router.get('/admin/individual-students', requireAuth, requireRole('master_admin'), asyncHandler(async (req, res) => {
  const { search, page = 1, limit = 20 } = req.query;
  const where = { role: 'individual_student' };
  if (search) {
    const { Op } = await import('sequelize');
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { email: { [Op.iLike]: `%${search}%` } },
    ];
  }

  const offset = (parseInt(page) - 1) * parseInt(limit);
  const { count, rows: users } = await User.findAndCountAll({
    where,
    order: [['created_at', 'DESC']],
    limit: parseInt(limit),
    offset,
    raw: true,
  });

  const userIds = users.map(u => u._id);

  let profileMap = {};
  if (userIds.length) {
    const [profiles] = await getSequelize().query(
      `SELECT * FROM individual_students WHERE user_id IN (:uids)`,
      { replacements: { uids: userIds } }
    );
    for (const p of profiles) profileMap[p.user_id] = p;
  }

  const subIds = Object.values(profileMap).map(p => p.subscription_id).filter(Boolean);
  let subMap = {};
  if (subIds.length) {
    const subscriptions = await Subscription.findAll({
      where: { _id: subIds },
      order: [['created_at', 'DESC']],
      raw: true,
    });
    for (const sub of subscriptions) subMap[sub._id] = sub;
  }

  let journeyMap = {};
  if (userIds.length) {
    const journeys = await StudentJourney.findAll({
      where: { student_id: userIds },
      raw: true,
    });
    for (const j of journeys) journeyMap[j.student_id] = j;
  }

  res.json({
    students: users.map(u => {
      const profile = profileMap[u._id] || {};
      const sub = subMap[profile.subscription_id] || null;
      const j = journeyMap[u._id];
      return {
        id: u._id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        is_active: u.is_active,
        subscription_status: profile.subscription_status || 'inactive',
        journey_access: profile.journey_access || 0,
        current_level: profile.current_level || 1,
        current_interview: profile.current_interview || 1,
        subscription: sub ? {
          id: sub._id,
          plan_key: sub.plan_key,
          plan_name: sub.plan_name,
          access_level: sub.access_level,
          status: sub.status,
          amount_paid: sub.amount_paid,
          start_date: sub.start_date,
        } : null,
        journey: j ? {
          current_level: j.current_level,
          completed_interviews: j.completed_interviews,
          readiness_score: j.readiness_score,
          status: j.status,
        } : null,
      };
    }),
    total: count,
    page: parseInt(page),
    limit: parseInt(limit),
    total_pages: Math.ceil(count / parseInt(limit)),
  });
}));

router.patch('/admin/individual-students/:studentId/subscription', requireAuth, requireRole('master_admin'), asyncHandler(async (req, res) => {
  const { action, plan_key } = req.body || {};
  const studentId = req.params.studentId;

  const student = await User.findOne({ where: { _id: studentId, role: 'individual_student' } });
  if (!student) throw new HttpError(404, 'Student not found');

  const currentSub = await Subscription.findOne({
    where: { student_id: studentId, status: 'active' },
    order: [['created_at', 'DESC']],
  });

  if (action === 'cancel') {
    if (currentSub) {
      await currentSub.update({ status: 'cancelled' });
      await StudentJourney.update(
        { journey_access_level: 0 },
        { where: { student_id: studentId } }
      );
    }
    return res.json({ success: true, message: 'Subscription cancelled' });
  }

  if (action === 'upgrade' || action === 'assign') {
    if (!plan_key || !PLANS[plan_key]) throw new HttpError(400, 'Invalid plan key');
    const plan = PLANS[plan_key];

    if (currentSub) {
      await currentSub.update({ status: 'upgraded' });
    }

    const gstAmount = Math.round(plan.amount * plan.gst_rate);
    const totalAmount = plan.amount + gstAmount;
    const invoiceNumber = generateInvoiceNumber();

    const newSub = await Subscription.create({
      student_id: studentId,
      plan_key: plan.key,
      plan_name: plan.name,
      access_level: plan.access_level,
      interviews_total: plan.interviews_total,
      status: 'active',
      amount_paid: plan.amount,
      gst_amount: gstAmount,
      start_date: new Date(),
      invoices: [{ number: invoiceNumber, date: new Date().toISOString(), amount: plan.amount, gst: gstAmount, total: totalAmount }],
    });

    await PaymentTransaction.create({
      student_id: studentId,
      subscription_id: newSub._id,
      amount: plan.amount,
      gst_amount: gstAmount,
      total_amount: totalAmount,
      status: 'completed',
      invoice_number: invoiceNumber,
      invoice_date: new Date(),
      invoice_items: [{ description: `${plan.name} Plan - Journey Access (Admin Assigned)`, amount: plan.amount, gst: gstAmount, total: totalAmount }],
      plan_key: plan.key,
      plan_name: plan.name,
    });

    const journey = await StudentJourney.findOne({ where: { student_id: studentId } });
    if (journey) {
      await journey.update({ journey_access_level: plan.access_level });
    } else {
      await StudentJourney.create({
        student_id: studentId,
        student_name: student.name || '',
        student_email: student.email || '',
        journey_access_level: plan.access_level,
        current_level: 1,
        status: 'not_started',
      });
    }

    return res.json({
      success: true,
      subscription: {
        id: newSub._id,
        plan_key: newSub.plan_key,
        plan_name: newSub.plan_name,
        access_level: newSub.access_level,
      },
    });
  }

  throw new HttpError(400, 'Invalid action. Use: upgrade, assign, or cancel');
}));

export default router;
