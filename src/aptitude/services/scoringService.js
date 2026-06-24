import { StudentAnswer, AssessmentAttempt, Question, Op } from '../../database/index.js';

export async function evaluateAttempt(attempt, assessment, questions) {
  const savedAnswers = await StudentAnswer.findAll({ where: { attempt_id: attempt._id } });
  const answerMap = new Map(
    savedAnswers.map((answer) => [answer.question_id, answer]),
  );

  let score = 0;

  for (const question of questions) {
    const existing = answerMap.get(question._id);
    const selected = existing?.selected_option || null;
    const isCorrect = selected === question.correct_option;
    const marksAwarded = !selected ? 0 : isCorrect ? question.marks : -question.negative_marks;
    score += marksAwarded;

    const [answer] = await StudentAnswer.findOrCreate({
      where: { attempt_id: attempt._id, question_id: question._id },
      defaults: { selected_option: selected, is_correct: isCorrect, marks_awarded: marksAwarded },
    });
    if (!answer.isNewRecord) {
      await answer.update({ selected_option: selected, is_correct: isCorrect, marks_awarded: marksAwarded });
    }
  }

  const totalMarks = assessment.total_marks || questions.reduce((sum, q) => sum + q.marks, 0);
  const percentage = totalMarks > 0 ? Number(((score / totalMarks) * 100).toFixed(2)) : 0;

  attempt.score = Number(score.toFixed(2));
  attempt.percentage = percentage;
  attempt.status = 'submitted';
  attempt.submitted_at = new Date();
  await attempt.save();

  return attempt;
}
