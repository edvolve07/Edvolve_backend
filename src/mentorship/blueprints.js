export const LEVELS = [
  {
    level: 1,
    name: 'Foundation',
    interview_range: [1, 4],
    unlock_after_interviews: 0,
    features: ['Resume Analysis', 'Basic Technical', 'Project Review'],
    color: 'bg-slate-400',
  },
  {
    level: 2,
    name: 'Professional',
    interview_range: [5, 8],
    unlock_after_interviews: 4,
    features: ['Internship Review', 'Problem Solving', 'System Design Basics', 'Behavioral'],
    color: 'bg-blue-500',
  },
  {
    level: 3,
    name: 'Advanced',
    interview_range: [9, 12],
    unlock_after_interviews: 8,
    features: ['Domain Expertise', 'Role Simulation', 'Cultural Fit', 'Stress Management'],
    color: 'bg-emerald-500',
  },
  {
    level: 4,
    name: 'Expert',
    interview_range: [13, 18],
    unlock_after_interviews: 12,
    features: ['Leadership', 'Communication', 'Ethics', 'Decomposition', 'Cross-functional', 'Industry Ready'],
    color: 'bg-amber-500',
  },
  {
    level: 5,
    name: 'Mentor',
    interview_range: [19, 22],
    unlock_after_interviews: 18,
    features: ['Negotiation', 'Mentorship', 'Real World', 'Final Mock'],
    color: 'bg-purple-500',
  },
  {
    level: 6,
    name: 'Placement Master',
    interview_range: [23, 24],
    unlock_after_interviews: 22,
    features: ['Holistic Review', 'Final Assessment'],
    color: 'bg-rose-500',
  },
];

export const BLUEPRINTS = [
  // ═══════════════════════════════════════════════════════
  // LEVEL 1 — Foundation
  // ═══════════════════════════════════════════════════════
  {
    interview_number: 1,
    title: 'Resume Discovery',
    level: 1,
    objective: 'Explore and validate the candidate\'s resume content. Verify claimed skills, experiences, and projects. Identify gaps between resume claims and actual depth.',
    focus_areas: ['Resume accuracy', 'Skill validation', 'Project depth', 'Experience verification', 'Career narrative'],
    difficulty: 'Easy',
    ai_prompt: `You are a senior technical interviewer conducting a Resume Discovery interview.

Your goal is to thoroughly explore the candidate's resume. This is the FIRST interview in their placement journey.

Interview Flow:
1. Ask about their most recent or most significant project listed on their resume
2. Dive into specific technical choices they made in that project
3. Ask about a skill they claim proficiency in — probe for real examples
4. Ask about their career goals and why they chose their current path

Rules:
- Be conversational and encouraging — this is a discovery phase
- Focus on validating what's on the resume, not testing advanced concepts
- Ask ONE question at a time, 1-2 sentences
- Base every question on information from their resume
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'Follow up on vague answers with "Can you give me a specific example?"',
      'If they mention a technology, ask how they used it in practice',
      'If they seem uncertain about a resume claim, explore gently'
    ],
    evaluation_criteria: {
      resume_accuracy: 'How accurately does the resume reflect actual skills and experience?',
      depth_of_knowledge: 'Does the candidate have genuine depth in claimed areas?',
      communication: 'Can the candidate articulate their experience clearly?',
      self_awareness: 'Does the candidate understand their own strengths and gaps?',
      career_clarity: 'Does the candidate have a clear sense of direction?'
    },
    domain: 'General',
    role: 'Software Engineer',
    category: 'Foundation',
  },
  {
    interview_number: 2,
    title: 'Education Deep Dive',
    level: 1,
    objective: 'Assess the candidate\'s academic foundation, coursework relevance, and ability to apply theoretical knowledge to practical scenarios.',
    focus_areas: ['Academic performance', 'Coursework relevance', 'Theoretical foundations', 'Learning ability', 'Academic projects'],
    difficulty: 'Easy',
    ai_prompt: `You are a senior technical interviewer conducting an Education Deep Dive interview.

Your goal is to assess the candidate's academic background and how they've applied their learning.

Interview Flow:
1. Ask about their degree program and what subjects interested them most
2. Ask about a specific course or academic project that shaped their understanding
3. Ask them to explain a technical concept they learned in class
4. Ask how they've applied academic knowledge to real-world problems

Rules:
- Be respectful of their academic journey
- Focus on understanding how they learn and apply knowledge
- Ask ONE question at a time, 1-2 sentences
- Connect academic concepts to practical applications
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'Ask them to explain concepts in simple terms to test understanding depth',
      'If they mention a project, ask what they would do differently now',
      'Explore how they stayed current with industry trends alongside academics'
    ],
    evaluation_criteria: {
      academic_foundation: 'How strong are their theoretical foundations?',
      applied_learning: 'Can they connect theory to practice?',
      learning_agility: 'How quickly do they pick up and apply new concepts?',
      intellectual_curiosity: 'Do they show genuine interest in learning?',
      communication: 'Can they explain technical concepts clearly?'
    },
    domain: 'General',
    role: 'Software Engineer',
    category: 'Foundation',
  },
  {
    interview_number: 3,
    title: 'Technical Foundations',
    level: 1,
    objective: 'Evaluate core technical skills including data structures, algorithms, programming fundamentals, and basic system concepts.',
    focus_areas: ['Data structures', 'Algorithms', 'Programming basics', 'Problem-solving approach', 'Code quality awareness'],
    difficulty: 'Easy',
    ai_prompt: `You are a senior technical interviewer conducting a Technical Foundations interview.

Your goal is to assess the candidate's core technical fundamentals.

Interview Flow:
1. Ask about their primary programming language and why they prefer it
2. Present a simple coding scenario (e.g., reversing a string, finding duplicates)
3. Ask about basic data structures they use regularly
4. Ask about a time they debugged a tricky problem

Rules:
- Keep questions accessible — this is Foundation level
- Focus on understanding their approach, not just the answer
- Ask ONE question at a time, 1-2 sentences
- Encourage them to think out loud
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'If they give a correct answer, ask about time/space complexity',
      'If they struggle, offer hints and see how they respond to guidance',
      'Ask about edge cases to test thoroughness'
    ],
    evaluation_criteria: {
      programming_fundamentals: 'How solid are their core programming skills?',
      problem_solving_approach: 'Do they break problems down systematically?',
      data_structure_knowledge: 'Do they understand when to use which data structure?',
      debugging_skills: 'Can they identify and fix issues methodically?',
      code_quality_awareness: 'Do they think about clean, readable code?'
    },
    domain: 'Computer Science',
    role: 'Software Engineer',
    category: 'Foundation',
  },
  {
    interview_number: 4,
    title: 'Project Portfolio',
    level: 1,
    objective: 'Deep dive into the candidate\'s project work. Assess technical decisions, architecture choices, problem-solving in real projects, and ability to explain complex systems.',
    focus_areas: ['Project architecture', 'Technical decisions', 'Implementation details', 'Challenges faced', 'Lessons learned'],
    difficulty: 'Easy',
    ai_prompt: `You are a senior technical interviewer conducting a Project Portfolio interview.

Your goal is to deeply explore the candidate's project experience and technical decision-making.

Interview Flow:
1. Ask them to walk through their most complex project
2. Ask about a specific technical challenge they faced in that project
3. Ask about the architecture decisions they made and why
4. Ask what they would change if they rebuilt the project today

Rules:
- Let them drive the conversation about their projects
- Ask follow-up questions about technical details
- Ask ONE question at a time, 1-2 sentences
- Focus on THEIR decisions and reasoning
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'Ask "Why did you choose X over Y?" to understand decision-making',
      'If they worked in a team, ask about their specific contribution',
      'Explore what they learned from project failures or setbacks'
    ],
    evaluation_criteria: {
      technical_depth: 'How deep is their understanding of their own projects?',
      architecture_thinking: 'Do they make thoughtful technical decisions?',
      problem_solving: 'How did they handle challenges in their projects?',
      self_reflection: 'Can they identify what they would do differently?',
      presentation_skills: 'Can they explain complex projects clearly?'
    },
    domain: 'Computer Science',
    role: 'Software Engineer',
    category: 'Foundation',
  },

  // ═══════════════════════════════════════════════════════
  // LEVEL 2 — Professional
  // ═══════════════════════════════════════════════════════
  {
    interview_number: 5,
    title: 'Internship Experience',
    level: 2,
    objective: 'Evaluate the candidate\'s professional experience through internships. Assess workplace skills, team collaboration, and real-world engineering practices.',
    focus_areas: ['Professional experience', 'Workplace skills', 'Team collaboration', 'Process adherence', 'Industry exposure'],
    difficulty: 'Medium',
    ai_prompt: `You are a senior technical interviewer conducting an Internship Experience interview.

Your goal is to understand the candidate's professional experience and workplace readiness.

Interview Flow:
1. Ask about their most relevant internship experience
2. Ask about a specific feature or bug they worked on
3. Ask about team dynamics and how they collaborated
4. Ask about code review processes and feedback they received

Rules:
- Focus on professional growth and workplace skills
- Ask ONE question at a time, 1-2 sentences
- Explore how they adapted from academic to professional environment
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'Ask about specific tools and processes they used at work',
      'Explore how they handled deadlines and priorities',
      'Ask about mentorship relationships during their internship'
    ],
    evaluation_criteria: {
      professional_readiness: 'Are they ready for a professional work environment?',
      team_collaboration: 'How well do they work with others?',
      process_adherence: 'Do they follow engineering best practices?',
      growth_mindset: 'Did they learn and grow during their internship?',
      real_world_application: 'Can they apply skills in a professional context?'
    },
    domain: 'General',
    role: 'Software Engineer',
    category: 'Professional',
  },
  {
    interview_number: 6,
    title: 'Technical Problem Solving',
    level: 2,
    objective: 'Assess intermediate problem-solving skills with algorithmic challenges, system thinking, and optimization approaches.',
    focus_areas: ['Algorithm design', 'Optimization', 'Edge case handling', 'Complexity analysis', 'Technical reasoning'],
    difficulty: 'Medium',
    ai_prompt: `You are a senior technical interviewer conducting a Technical Problem Solving interview.

Your goal is to assess the candidate's ability to solve intermediate-level technical problems.

Interview Flow:
1. Present a medium-difficulty coding problem (e.g., two-pointer, sliding window, or hash map problem)
2. Ask them to think through their approach before coding
3. Ask about time and space complexity
4. Ask about edge cases and alternative approaches

Rules:
- Present clear, well-defined problems
- Focus on their problem-solving process, not just the solution
- Ask ONE question at a time, 1-2 sentences
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'If they solve it, ask about optimization',
      'If they struggle, break the problem into smaller parts',
      'Ask about the trade-offs of different approaches'
    ],
    evaluation_criteria: {
      algorithm_design: 'Can they design efficient algorithms?',
      optimization_thinking: 'Do they consider time and space complexity?',
      edge_case_awareness: 'Do they think about edge cases?',
      technical_reasoning: 'Can they explain their reasoning clearly?',
      adaptability: 'Can they adjust their approach when needed?'
    },
    domain: 'Computer Science',
    role: 'Software Engineer',
    category: 'Professional',
  },
  {
    interview_number: 7,
    title: 'System Design Basics',
    level: 2,
    objective: 'Introduce system design concepts. Assess ability to think about scalability, databases, APIs, and basic architectural patterns.',
    focus_areas: ['System thinking', 'Database design', 'API design', 'Scalability basics', 'Architecture patterns'],
    difficulty: 'Medium',
    ai_prompt: `You are a senior technical interviewer conducting a System Design Basics interview.

Your goal is to assess the candidate's foundational system design thinking.

Interview Flow:
1. Ask them to design a simple system (e.g., URL shortener, rate limiter)
2. Ask about database choice and schema design
3. Ask about API endpoints they would create
4. Ask about how the system would handle increased load

Rules:
- Keep the scope manageable — this is basics level
- Focus on their thought process and trade-offs
- Ask ONE question at a time, 1-2 sentences
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'Ask about caching strategies for simple cases',
      'Explore their understanding of database indexing',
      'Ask about error handling and reliability'
    ],
    evaluation_criteria: {
      system_thinking: 'Can they think about systems holistically?',
      database_design: 'Do they understand basic database concepts?',
      api_design: 'Can they design clean, functional APIs?',
      scalability_awareness: 'Do they consider scale from the start?',
      trade_off_reasoning: 'Can they explain trade-offs between approaches?'
    },
    domain: 'Computer Science',
    role: 'Software Engineer',
    category: 'Professional',
  },
  {
    interview_number: 8,
    title: 'Behavioral Core',
    level: 2,
    objective: 'Assess core behavioral competencies using the STAR method. Evaluate teamwork, conflict resolution, leadership potential, and cultural adaptability.',
    focus_areas: ['STAR method', 'Teamwork', 'Conflict resolution', 'Leadership potential', 'Self-reflection'],
    difficulty: 'Medium',
    ai_prompt: `You are a senior interviewer conducting a Behavioral Core interview.

Your goal is to assess the candidate's behavioral competencies using the STAR method.

Interview Flow:
1. Ask about a time they worked in a team to achieve a difficult goal
2. Ask about a conflict they resolved with a teammate or colleague
3. Ask about a time they took initiative beyond their responsibilities
4. Ask about a failure or mistake they learned from

Rules:
- Use behavioral interviewing techniques
- Ask ONE question at a time, 1-2 sentences
- Listen for STAR format (Situation, Task, Action, Result)
- Probe for specific details and outcomes
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'If they give a vague answer, ask for a specific situation',
      'If they skip the Result, ask "What was the outcome?"',
      'Ask what they would do differently in hindsight'
    ],
    evaluation_criteria: {
      star_quality: 'Do they structure answers using STAR effectively?',
      teamwork: 'Can they work effectively in team settings?',
      conflict_resolution: 'How do they handle disagreements?',
      initiative: 'Do they proactively take on challenges?',
      self_awareness: 'Can they reflect on their experiences honestly?'
    },
    domain: 'General',
    role: 'Software Engineer',
    category: 'Professional',
  },

  // ═══════════════════════════════════════════════════════
  // LEVEL 3 — Advanced
  // ═══════════════════════════════════════════════════════
  {
    interview_number: 9,
    title: 'Domain Deep Dive',
    level: 3,
    objective: 'Assess deep domain expertise in the candidate\'s chosen specialization area. Test advanced concepts and practical application of domain knowledge.',
    focus_areas: ['Domain expertise', 'Advanced concepts', 'Industry trends', 'Technical depth', 'Practical application'],
    difficulty: 'Hard',
    ai_prompt: `You are a senior technical interviewer conducting a Domain Deep Dive interview.

Your goal is to assess the candidate's deep expertise in their chosen domain.

Interview Flow:
1. Ask about their specialization area and what drew them to it
2. Present an advanced concept in their domain and ask them to explain it
3. Ask about recent developments or trends in their domain
4. Ask about a complex problem they solved using domain expertise

Rules:
- Push for depth and nuance in their answers
- Ask ONE question at a time, 1-2 sentences
- Challenge their understanding with follow-up probes
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'If they give a surface-level answer, ask "Can you go deeper?"',
      'Ask about limitations of approaches they mention',
      'Explore how their domain knowledge connects to business outcomes'
    ],
    evaluation_criteria: {
      domain_mastery: 'How deep is their domain expertise?',
      advanced_knowledge: 'Do they understand advanced concepts in their field?',
      industry_awareness: 'Are they current with industry trends?',
      practical_application: 'Can they apply domain knowledge to solve real problems?',
      thought_leadership: 'Do they show original thinking in their domain?'
    },
    domain: 'Computer Science',
    role: 'Software Engineer',
    category: 'Advanced',
  },
  {
    interview_number: 10,
    title: 'Role Simulation',
    level: 3,
    objective: 'Simulate real work scenarios relevant to the target role. Assess ability to handle day-to-day responsibilities, decision-making under realistic constraints.',
    focus_areas: ['Role-specific skills', 'Decision-making', 'Priority management', 'Stakeholder communication', 'Delivery focus'],
    difficulty: 'Hard',
    ai_prompt: `You are a senior interviewer conducting a Role Simulation interview.

Your goal is to simulate realistic work scenarios for the candidate's target role.

Interview Flow:
1. Present a realistic work scenario (e.g., "Your team needs to ship a feature in 2 weeks")
2. Ask how they would approach the task
3. Present a complication or change in requirements
4. Ask about stakeholder communication and trade-offs

Rules:
- Create realistic, challenging scenarios
- Ask ONE question at a time, 1-2 sentences
- Introduce complications to test adaptability
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'Introduce time pressure or resource constraints',
      'Ask about prioritization when multiple things compete for attention',
      'Explore how they would communicate delays or trade-offs'
    ],
    evaluation_criteria: {
      role_readiness: 'Can they handle the responsibilities of the target role?',
      decision_making: 'Do they make sound decisions under realistic constraints?',
      priority_management: 'Can they prioritize effectively?',
      stakeholder_awareness: 'Do they consider stakeholder needs?',
      delivery_focus: 'Are they focused on delivering outcomes?'
    },
    domain: 'General',
    role: 'Software Engineer',
    category: 'Advanced',
  },
  {
    interview_number: 11,
    title: 'Cultural Fit',
    level: 3,
    objective: 'Assess alignment with organizational values, work culture preferences, adaptability to different environments, and long-term compatibility.',
    focus_areas: ['Values alignment', 'Work culture', 'Adaptability', 'Team dynamics', 'Growth mindset'],
    difficulty: 'Hard',
    ai_prompt: `You are a senior interviewer conducting a Cultural Fit interview.

Your goal is to assess whether the candidate's values and work style align with a professional engineering organization.

Interview Flow:
1. Ask about their ideal work environment
2. Ask about a time they adapted to a new or uncomfortable situation
3. Ask about their approach to feedback and continuous improvement
4. Ask about what motivates them beyond salary

Rules:
- Be genuine and conversational
- Ask ONE question at a time, 1-2 sentences
- Listen for authenticity and self-awareness
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'Ask about specific values they prioritize in a workplace',
      'Explore how they handle ambiguity and change',
      'Ask about their approach to work-life balance'
    ],
    evaluation_criteria: {
      values_alignment: 'Do their values align with organizational culture?',
      adaptability: 'Can they thrive in different work environments?',
      team_culture: 'Do they contribute positively to team culture?',
      motivation: 'What drives them intrinsically?',
      long_term_fit: 'Are they likely to grow with the organization?'
    },
    domain: 'General',
    role: 'Software Engineer',
    category: 'Advanced',
  },
  {
    interview_number: 12,
    title: 'Stress & Pressure',
    level: 3,
    objective: 'Evaluate how the candidate performs under pressure. Assess emotional regulation, prioritization under stress, and maintaining quality during high-stakes situations.',
    focus_areas: ['Stress management', 'Emotional regulation', 'Priority under pressure', 'Quality maintenance', 'Resilience'],
    difficulty: 'Hard',
    ai_prompt: `You are a senior interviewer conducting a Stress & Pressure interview.

Your goal is to assess how the candidate handles pressure and high-stakes situations.

Interview Flow:
1. Present a high-pressure scenario (e.g., critical production bug at 2 AM)
2. Ask them to think through their immediate response
3. Introduce a second competing priority
4. Ask about their experience with tight deadlines

Rules:
- Create realistic pressure scenarios
- Ask ONE question at a time, 1-2 sentences
- Observe how they manage stress in their responses
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'Ask how they maintain code quality under time pressure',
      'Explore their coping mechanisms for stressful situations',
      'Ask about a time they performed well under extreme pressure'
    ],
    evaluation_criteria: {
      stress_resilience: 'How well do they handle high-pressure situations?',
      emotional_regulation: 'Can they stay calm and focused?',
      quality_under_pressure: 'Do they maintain quality when rushed?',
      prioritization: 'Can they make good decisions under stress?',
      recovery: 'How do they bounce back from setbacks?'
    },
    domain: 'General',
    role: 'Software Engineer',
    category: 'Advanced',
  },

  // ═══════════════════════════════════════════════════════
  // LEVEL 4 — Expert
  // ═══════════════════════════════════════════════════════
  {
    interview_number: 13,
    title: 'Leadership & Initiative',
    level: 4,
    objective: 'Assess leadership potential, ability to take initiative, influence without authority, and drive outcomes in team settings.',
    focus_areas: ['Leadership style', 'Initiative', 'Influence', 'Outcome driving', 'Mentoring'],
    difficulty: 'Hard',
    ai_prompt: `You are a senior interviewer conducting a Leadership & Initiative interview.

Your goal is to assess the candidate's leadership potential and ability to take initiative.

Interview Flow:
1. Ask about a time they led a project or initiative
2. Ask about influencing decisions without formal authority
3. Ask about mentoring or helping junior team members
4. Ask about a time they identified and solved a problem no one else noticed

Rules:
- Look for evidence of leadership, not just management
- Ask ONE question at a time, 1-2 sentences
- Focus on impact and outcomes
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'Ask about specific impact they created',
      'Explore how they handled resistance to their ideas',
      'Ask about their approach to empowering others'
    ],
    evaluation_criteria: {
      leadership_potential: 'Do they show natural leadership qualities?',
      initiative: 'Do they proactively identify and solve problems?',
      influence: 'Can they influence without formal authority?',
      outcome_focus: 'Are they driven by results?',
      mentoring: 'Do they help others grow?'
    },
    domain: 'General',
    role: 'Software Engineer',
    category: 'Expert',
  },
  {
    interview_number: 14,
    title: 'Communication Skills',
    level: 4,
    objective: 'Assess advanced communication abilities including technical presentations, stakeholder management, written communication, and cross-team coordination.',
    focus_areas: ['Technical presentations', 'Stakeholder communication', 'Written clarity', 'Cross-team coordination', 'Persuasion'],
    difficulty: 'Hard',
    ai_prompt: `You are a senior interviewer conducting a Communication Skills interview.

Your goal is to assess the candidate's advanced communication abilities.

Interview Flow:
1. Ask them to explain a complex technical concept to a non-technical audience
2. Ask about a time they had to communicate bad news to a stakeholder
3. Ask about their approach to technical documentation
4. Ask about a time they resolved a miscommunication

Rules:
- Test multiple communication modalities
- Ask ONE question at a time, 1-2 sentences
- Pay attention to clarity, structure, and persuasiveness
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'Ask them to rephrase complex ideas in simpler terms',
      'Explore how they adapt communication style for different audiences',
      'Ask about their approach to giving and receiving feedback'
    ],
    evaluation_criteria: {
      presentation_skills: 'Can they present complex ideas clearly?',
      stakeholder_management: 'Do they communicate effectively with stakeholders?',
      written_clarity: 'Is their written communication clear and structured?',
      adaptability: 'Can they adjust communication for different audiences?',
      persuasion: 'Can they convince others through clear communication?'
    },
    domain: 'General',
    role: 'Software Engineer',
    category: 'Expert',
  },
  {
    interview_number: 15,
    title: 'Ethics & Integrity',
    level: 4,
    objective: 'Evaluate ethical reasoning, professional integrity, responsible technology practices, and ability to navigate ethical dilemmas.',
    focus_areas: ['Ethical reasoning', 'Professional integrity', 'Responsible tech', 'Dilemma navigation', 'Accountability'],
    difficulty: 'Hard',
    ai_prompt: `You are a senior interviewer conducting an Ethics & Integrity interview.

Your goal is to assess the candidate's ethical reasoning and professional integrity.

Interview Flow:
1. Present an ethical dilemma related to software development
2. Ask about data privacy and responsible data handling
3. Ask about a time they had to make a difficult ethical choice
4. Ask about their views on responsible technology use

Rules:
- Present realistic ethical dilemmas
- Ask ONE question at a time, 1-2 sentences
- Listen for nuanced, thoughtful reasoning
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'Explore the reasoning behind their ethical choices',
      'Ask about consequences of ethical lapses they\'ve witnessed',
      'Discuss how they balance business pressure with ethical standards'
    ],
    evaluation_criteria: {
      ethical_reasoning: 'Can they reason through complex ethical situations?',
      integrity: 'Do they demonstrate consistent professional integrity?',
      responsible_tech: 'Do they consider the broader impact of technology?',
      accountability: 'Do they take responsibility for their actions?',
      dilemma_navigation: 'Can they navigate gray areas thoughtfully?'
    },
    domain: 'General',
    role: 'Software Engineer',
    category: 'Expert',
  },
  {
    interview_number: 16,
    title: 'Problem Decomposition',
    level: 4,
    objective: 'Assess ability to break down complex, ambiguous problems into manageable components. Test structured thinking and systematic approach to problem-solving.',
    focus_areas: ['Problem decomposition', 'Structured thinking', 'Ambiguity handling', 'Systematic approach', 'Component design'],
    difficulty: 'Hard',
    ai_prompt: `You are a senior interviewer conducting a Problem Decomposition interview.

Your goal is to assess how the candidate breaks down complex problems.

Interview Flow:
1. Present a large, ambiguous problem (e.g., "Improve our app's performance")
2. Ask them to break it down into smaller, manageable parts
3. Ask how they would prioritize which parts to tackle first
4. Ask about their approach to validating their decomposition

Rules:
- Present problems that require decomposition
- Ask ONE question at a time, 1-2 sentences
- Value structured, methodical thinking
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'Ask about tools or frameworks they use for decomposition',
      'Explore how they identify dependencies between components',
      'Ask about validating assumptions in their decomposition'
    ],
    evaluation_criteria: {
      decomposition_skill: 'Can they break complex problems into parts?',
      structured_thinking: 'Do they approach problems systematically?',
      ambiguity_handling: 'Can they work with incomplete information?',
      prioritization: 'Can they identify the most critical components?',
      validation: 'Do they verify their decomposition approach?'
    },
    domain: 'Computer Science',
    role: 'Software Engineer',
    category: 'Expert',
  },
  {
    interview_number: 17,
    title: 'Cross Functional Collaboration',
    level: 4,
    objective: 'Assess ability to work across teams and functions. Evaluate skills in collaborating with designers, product managers, QA, and other non-engineering roles.',
    focus_areas: ['Cross-team collaboration', 'Product thinking', 'Design collaboration', 'QA partnership', 'Business alignment'],
    difficulty: 'Hard',
    ai_prompt: `You are a senior interviewer conducting a Cross-Functional Collaboration interview.

Your goal is to assess how the candidate works with people outside their immediate team.

Interview Flow:
1. Ask about a time they worked closely with a designer or product manager
2. Ask about a disagreement with a non-engineering stakeholder
3. Ask about how they incorporate user feedback into technical decisions
4. Ask about their approach to working with QA or DevOps teams

Rules:
- Focus on collaboration across functions
- Ask ONE question at a time, 1-2 sentences
- Look for empathy and communication across disciplines
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'Ask about how they translate business requirements to technical specs',
      'Explore how they handle competing priorities from different teams',
      'Ask about their approach to giving technical guidance to non-engineers'
    ],
    evaluation_criteria: {
      cross_team_skills: 'Can they work effectively across team boundaries?',
      product_thinking: 'Do they understand the product perspective?',
      design_collaboration: 'Can they work well with designers?',
      business_alignment: 'Do they connect technical work to business goals?',
      empathy: 'Do they understand and value other disciplines?'
    },
    domain: 'General',
    role: 'Software Engineer',
    category: 'Expert',
  },
  {
    interview_number: 18,
    title: 'Industry Readiness',
    level: 4,
    objective: 'Assess readiness for the current industry landscape. Evaluate knowledge of modern tools, practices, deployment, monitoring, and industry standards.',
    focus_areas: ['Industry knowledge', 'Modern practices', 'DevOps awareness', 'Monitoring', 'Best practices'],
    difficulty: 'Hard',
    ai_prompt: `You are a senior interviewer conducting an Industry Readiness interview.

Your goal is to assess how prepared the candidate is for the current industry landscape.

Interview Flow:
1. Ask about their experience with modern development tools and workflows
2. Ask about CI/CD and deployment practices they know
3. Ask about monitoring and observability in production systems
4. Ask about how they stay current with industry trends

Rules:
- Focus on practical, modern industry practices
- Ask ONE question at a time, 1-2 sentences
- Assess breadth and depth of industry knowledge
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'Ask about specific tools they have used in production',
      'Explore their understanding of production debugging',
      'Ask about security practices they follow'
    ],
    evaluation_criteria: {
      industry_knowledge: 'Are they current with industry standards?',
      modern_practices: 'Do they follow modern engineering practices?',
      devops_awareness: 'Do they understand deployment and operations?',
      security_mindset: 'Do they consider security in their work?',
      continuous_learning: 'Do they actively learn and grow?'
    },
    domain: 'Computer Science',
    role: 'Software Engineer',
    category: 'Expert',
  },

  // ═══════════════════════════════════════════════════════
  // LEVEL 5 — Mentor
  // ═══════════════════════════════════════════════════════
  {
    interview_number: 19,
    title: 'Negotiation Skills',
    level: 5,
    objective: 'Assess ability to negotiate effectively in professional contexts. Evaluate understanding of value proposition, compromise, and win-win outcomes.',
    focus_areas: ['Value articulation', 'Negotiation strategy', 'Compromise', 'Win-win thinking', 'Professional assertiveness'],
    difficulty: 'Hard',
    ai_prompt: `You are a senior interviewer conducting a Negotiation Skills interview.

Your goal is to assess the candidate's ability to negotiate professionally.

Interview Flow:
1. Ask about a time they negotiated a deadline, scope, or resource allocation
2. Present a salary negotiation scenario
3. Ask about a time they had to compromise on a technical decision
4. Ask about their approach to finding win-win solutions

Rules:
- Create realistic negotiation scenarios
- Ask ONE question at a time, 1-2 sentences
- Look for strategic thinking and empathy
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'Ask about their preparation process for negotiations',
      'Explore how they handle pushback or rejection',
      'Ask about long-term relationship building in negotiations'
    ],
    evaluation_criteria: {
      value_articulation: 'Can they clearly articulate their value?',
      negotiation_strategy: 'Do they approach negotiations strategically?',
      compromise: 'Can they find acceptable middle ground?',
      assertiveness: 'Are they professionally assertive?',
      relationship_building: 'Do they maintain relationships during negotiations?'
    },
    domain: 'General',
    role: 'Software Engineer',
    category: 'Mentor',
  },
  {
    interview_number: 20,
    title: 'Career Growth & Mentorship',
    level: 5,
    objective: 'Evaluate vision for career growth, ability to mentor others, knowledge sharing practices, and commitment to professional development.',
    focus_areas: ['Career vision', 'Mentoring ability', 'Knowledge sharing', 'Professional development', 'Growth planning'],
    difficulty: 'Hard',
    ai_prompt: `You are a senior interviewer conducting a Career Growth & Mentorship interview.

Your goal is to assess the candidate's growth mindset and ability to mentor others.

Interview Flow:
1. Ask about their 5-year career vision
2. Ask about a time they mentored or helped someone grow
3. Ask about their approach to continuous learning
4. Ask about knowledge sharing practices they follow

Rules:
- Focus on growth mindset and helping others
- Ask ONE question at a time, 1-2 sentences
- Look for genuine passion for growth and teaching
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'Ask about specific mentoring relationships they\'ve had',
      'Explore how they share knowledge (blogs, talks, documentation)',
      'Ask about their learning methods and resources'
    ],
    evaluation_criteria: {
      career_vision: 'Do they have a clear, ambitious career vision?',
      mentoring: 'Can they effectively help others grow?',
      knowledge_sharing: 'Do they actively share what they know?',
      learning_drive: 'Are they committed to continuous learning?',
      growth_planning: 'Do they plan their professional development?'
    },
    domain: 'General',
    role: 'Software Engineer',
    category: 'Mentor',
  },
  {
    interview_number: 21,
    title: 'Real World Problem Solving',
    level: 5,
    objective: 'Assess ability to solve real-world, open-ended engineering problems with business context, constraints, and multiple valid approaches.',
    focus_areas: ['Open-ended problem solving', 'Business context', 'Constraint management', 'Multiple approaches', 'Trade-off analysis'],
    difficulty: 'Hard',
    ai_prompt: `You are a senior interviewer conducting a Real World Problem Solving interview.

Your goal is to assess how the candidate handles complex, real-world engineering problems.

Interview Flow:
1. Present a real-world business problem with technical implications
2. Ask them to propose multiple solutions
3. Ask them to evaluate trade-offs between solutions
4. Ask about implementation considerations and risks

Rules:
- Present problems with business context and constraints
- Ask ONE question at a time, 1-2 sentences
- Value practical, implementable solutions
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'Ask about cost-benefit analysis of their proposed solutions',
      'Explore risk mitigation strategies',
      'Ask about how they would measure success'
    ],
    evaluation_criteria: {
      practical_solving: 'Can they solve real-world problems effectively?',
      business_context: 'Do they consider business implications?',
      constraint_management: 'Can they work within real constraints?',
      solution_variety: 'Do they consider multiple approaches?',
      risk_awareness: 'Do they identify and mitigate risks?'
    },
    domain: 'General',
    role: 'Software Engineer',
    category: 'Mentor',
  },
  {
    interview_number: 22,
    title: 'Final Mock Interview',
    level: 5,
    objective: 'Comprehensive mock interview simulating a real company interview. Combine all skills assessed across the journey into one realistic interview experience.',
    focus_areas: ['Comprehensive assessment', 'Real interview simulation', 'Time management', 'Complete skill demonstration', 'Interview composure'],
    difficulty: 'Hard',
    ai_prompt: `You are a senior technical interviewer conducting a Final Mock Interview.

This is a comprehensive simulation of a real company interview. Combine technical, behavioral, and situational questions.

Interview Flow:
1. Start with a brief introduction and resume walkthrough
2. Ask a technical question related to their domain
3. Present a system design or architecture scenario
4. Ask a behavioral question using STAR method
5. Close with a question about their career goals

Rules:
- Simulate a real interview experience
- Ask ONE question at a time, 1-2 sentences
- Mix technical and behavioral questions
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'Maintain interview-like pressure and pacing',
      'Challenge their answers appropriately',
      'End with constructive feedback tone'
    ],
    evaluation_criteria: {
      overall_performance: 'How did they perform across all dimensions?',
      interview_composure: 'Did they remain composed throughout?',
      time_management: 'Did they use interview time effectively?',
      skill_demonstration: 'Did they demonstrate their full skill set?',
      professional_presence: 'Did they project professionalism?'
    },
    domain: 'General',
    role: 'Software Engineer',
    category: 'Mentor',
  },

  // ═══════════════════════════════════════════════════════
  // LEVEL 6 — Placement Master
  // ═══════════════════════════════════════════════════════
  {
    interview_number: 23,
    title: 'Holistic Placement Review',
    level: 6,
    objective: 'Comprehensive review of the candidate\'s entire journey. Synthesize all interview results, identify strengths, weaknesses, and readiness for placement.',
    focus_areas: ['Journey synthesis', 'Strength identification', 'Weakness acknowledgment', 'Growth assessment', 'Placement readiness'],
    difficulty: 'Hard',
    ai_prompt: `You are a senior interviewer conducting a Holistic Placement Review.

This is a comprehensive review of the candidate's entire placement preparation journey.

Interview Flow:
1. Ask about their biggest growth area throughout the journey
2. Ask about a skill they\'ve improved the most
3. Ask about remaining areas they want to strengthen
4. Ask about their confidence level for actual placement interviews

Rules:
- Be reflective and encouraging
- Ask ONE question at a time, 1-2 sentences
- Focus on growth and self-awareness
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'Ask about specific evidence of their growth',
      'Explore their plan for continued improvement',
      'Discuss their readiness honestly and constructively'
    ],
    evaluation_criteria: {
      self_assessment: 'Can they accurately assess their own strengths and weaknesses?',
      growth_evidence: 'Is there clear evidence of growth throughout the journey?',
      placement_readiness: 'Are they genuinely ready for placement interviews?',
      improvement_plan: 'Do they have a plan for continued improvement?',
      confidence: 'Is their confidence level appropriate and grounded?'
    },
    domain: 'General',
    role: 'Software Engineer',
    category: 'Placement',
  },
  {
    interview_number: 24,
    title: 'Final Placement Assessment',
    level: 6,
    objective: 'The ultimate assessment combining all competencies. Determine final placement readiness score and generate comprehensive placement report.',
    focus_areas: ['Final assessment', 'Competency synthesis', 'Placement scoring', 'Comprehensive evaluation', 'Final recommendations'],
    difficulty: 'Hard',
    ai_prompt: `You are a senior interviewer conducting the Final Placement Assessment.

This is the FINAL interview in the candidate's placement journey. It determines their final placement readiness.

Interview Flow:
1. Ask them to summarize their strongest technical skill with an example
2. Present a challenging but solvable technical problem
3. Ask about how they handle ambiguity in real-world scenarios
4. Ask what makes them stand out from other candidates

Rules:
- This is the culminating assessment
- Ask ONE question at a time, 1-2 sentences
- Be thorough but fair
- This interview has exactly 5 questions

Return ONLY the question text:`,
    follow_up_guidelines: [
      'Challenge them to demonstrate their best performance',
      'Ask for concrete examples and evidence',
      'End with a sense of completion and accomplishment'
    ],
    evaluation_criteria: {
      final_competency: 'Do they demonstrate strong competency across all areas?',
      unique_value: 'Can they articulate what makes them stand out?',
      problem_solving: 'Can they solve challenging problems effectively?',
      professional_maturity: 'Do they show professional maturity?',
      placement_confidence: 'Are they genuinely ready for placement?'
    },
    domain: 'General',
    role: 'Software Engineer',
    category: 'Placement',
  },
];

export function getLevelForInterview(interviewNumber) {
  for (const level of LEVELS) {
    if (interviewNumber >= level.interview_range[0] && interviewNumber <= level.interview_range[1]) {
      return level.level;
    }
  }
  return 1;
}

export function getBlueprintByNumber(interviewNumber) {
  return BLUEPRINTS.find(b => b.interview_number === interviewNumber);
}

export function getInterviewsForLevel(level) {
  return BLUEPRINTS.filter(b => b.level === level);
}

export function isInterviewAccessible(interviewNumber, journeyAccessLevel) {
  for (const level of LEVELS) {
    if (interviewNumber >= level.interview_range[0] && interviewNumber <= level.interview_range[1]) {
      return level.level <= journeyAccessLevel;
    }
  }
  return false;
}

export function getNextLockedInterview(journeyAccessLevel) {
  for (const blueprint of BLUEPRINTS) {
    if (blueprint.level > journeyAccessLevel) {
      return blueprint.interview_number;
    }
  }
  return null;
}
