/*
 * Interview prep: a question bank and the pure logic around it.
 *
 * Questions are grouped (behavioral, technical, internship logistics, questions to ask them) and
 * have stable ids, because a page's progress is stored by id in its optional `interview` field
 * ({ [id]: { status, note? } }, cleaned by domain.cleanInterview). Never reuse or rename an id:
 * add a new question instead, so saved progress keeps pointing at the right text. Nothing here
 * touches the DOM or storage; it imports only domain.js.
 */
import { INTERVIEW_STATUSES, cleanInterview } from "./domain.js";

export const QUESTION_GROUPS = Object.freeze([
  { id: "behavioral", label: "Behavioral", hint: "Stories about how you work. Answer with situation, action, result." },
  { id: "technical", label: "Technical", hint: "Matched to the role's field." },
  { id: "logistics", label: "Internship logistics", hint: "Dates, location, pay, and paperwork. Have answers ready." },
  { id: "ask", label: "Questions to ask them", hint: "Pick two or three for the end of the interview." }
]);

const ANSWER_SECONDS = { behavioral: 90, technical: 120, logistics: 60, ask: 45 };
const q = (id, group, text, tags, keyPoints, outline, followUps) => Object.freeze({
  id, group, text, tags: Object.freeze(tags), seconds: ANSWER_SECONDS[group],
  keyPoints: Object.freeze(keyPoints), outline, followUps: Object.freeze(followUps)
});

export const QUESTION_BANK = Object.freeze([
  // Behavioral
  q("b-about-you", "behavioral", "Tell me about yourself.", [],
    ["Relevant background and interests", "Your contribution to a recent project", "Skills you want to develop"],
    "Situation: your background. Task: a relevant project. Action: your contribution. Result: what you learned and want to do next.",
    ["Which experience best prepared you for this internship?", "What would you like to learn here?"]),
  q("b-why-company", "behavioral", "Why do you want to work here?", [],
    ["Specific company work that interests you", "Connection to your experience or values", "Contribution you could make"],
    "Situation: work the company does. Task: the need that interests you. Action: relevant experience you bring. Result: the contribution you hope to make.",
    ["What did you learn about our work?", "Which part of our work would you like to contribute to?"]),
  q("b-why-role", "behavioral", "Why this role?", [],
    ["Role responsibilities that interest you", "Evidence of relevant skills", "Learning goals for the internship"],
    "Situation: what drew you to this field. Task: a responsibility you enjoy. Action: a relevant example. Result: what you want to learn in this role.",
    ["Which responsibility would be most challenging for you?", "What have you done to explore this field?"]),
  q("b-proud-project", "behavioral", "Tell me about a project you're proud of.", [],
    ["Project goal and constraints", "Your specific actions and decisions", "Results and lessons learned"],
    "Situation: the project context. Task: your goal and constraints. Action: your decisions and work. Result: the outcome and what you learned.",
    ["What part was yours?", "What would you change if you did it again?"]),
  q("b-team-conflict", "behavioral", "Describe a disagreement with a teammate and how you handled it.", [],
    ["Different viewpoints and shared goal", "Listening and respectful discussion", "Agreement and effect on the team"],
    "Situation: the disagreement. Task: the shared goal. Action: how you listened and worked toward agreement. Result: the effect on the work and relationship.",
    ["What did you learn from the other person?", "What would you do if you still disagreed?"]),
  q("b-failure", "behavioral", "Tell me about a time something went wrong. What did you learn?", [],
    ["What went wrong and your responsibility", "Actions to recover or limit harm", "Lesson and changes to your approach"],
    "Situation: what went wrong. Task: your responsibility. Action: how you responded. Result: the recovery and a change you made afterward.",
    ["What warning signs did you miss?", "How have you applied that lesson since?"]),
  q("b-deadline", "behavioral", "Tell me about a time you had a tight deadline.", [],
    ["Deadline and essential deliverables", "Priorities and scope decisions", "Communication and final outcome"],
    "Situation: the tight deadline. Task: the essential deliverables. Action: priorities, scope, and communication. Result: what you delivered and learned.",
    ["What did you decide to leave out?", "When did you tell others about the risk?"]),
  q("b-learn-fast", "behavioral", "Describe a time you had to learn something quickly.", [],
    ["Knowledge gap and immediate goal", "Learning resources and deliberate practice", "Application and evidence of progress"],
    "Situation: unfamiliar work. Task: what you needed to learn. Action: resources, practice, and asking for help. Result: how you applied the learning.",
    ["How did you know you understood it?", "What did you do when you got stuck?"]),
  q("b-feedback", "behavioral", "Tell me about feedback that changed how you work.", [],
    ["Specific feedback and its context", "How you clarified and applied feedback", "Change in your work and results"],
    "Situation: the feedback you received. Task: the behavior to improve. Action: how you applied it. Result: the change in your work.",
    ["Was any part of the feedback hard to hear?", "How did you check whether you improved?"]),
  q("b-lead", "behavioral", "Tell me about a time you took the lead without being asked.", [],
    ["Unmet need and shared goal", "Initiative and involvement of others", "Outcome and credit to the team"],
    "Situation: a need nobody had taken on. Task: the shared goal. Action: your initiative and how you involved others. Result: the team outcome.",
    ["How did you get others involved?", "What would you do differently next time?"]),
  q("b-ambiguity", "behavioral", "Describe a time the goal was unclear. What did you do?", [],
    ["Unclear goal and missing information", "Questions and assumptions you checked", "Agreed next steps and outcome"],
    "Situation: the unclear request. Task: define a useful goal. Action: questions, checked assumptions, and a small next step. Result: clarity and progress.",
    ["Which assumption mattered most?", "How did you decide when you had enough information?"]),
  q("b-strength", "behavioral", "What's your biggest strength?", [],
    ["Specific strength relevant to the work", "Example of how you used it", "Impact and limits of that strength"],
    "Situation: an example that needed your strength. Task: your responsibility. Action: how you used it. Result: the impact and when you need another approach.",
    ["How do others notice this strength?", "When can that strength be less helpful?"]),
  q("b-improve", "behavioral", "What's something you're working to improve?", [],
    ["Specific skill or habit to improve", "Concrete steps and practice", "Progress and how you measure it"],
    "Situation: where you noticed a gap. Task: the improvement goal. Action: steps and practice. Result: progress so far and your next step.",
    ["What progress have you seen?", "How could a mentor help you improve?"]),
  q("b-prioritize", "behavioral", "How do you prioritize when everything feels urgent?", [],
    ["Impact and urgency of competing work", "Dependencies and realistic effort", "Agreed priorities and communication"],
    "Situation: competing requests. Task: identify the most important outcome. Action: compare impact, urgency, and dependencies; agree priorities. Result: what got done.",
    ["What if two people both say their work comes first?", "When do you revisit your priorities?"]),
  q("b-helped", "behavioral", "Tell me about a time you helped someone else succeed.", [],
    ["Other person's goal and obstacle", "Support that respected their ownership", "Their progress and what you learned"],
    "Situation: someone needed support. Task: understand their goal. Action: help while keeping their ownership. Result: their progress and your learning.",
    ["How did you know what help they needed?", "How did you balance helping with your own work?"]),
  q("b-after", "behavioral", "Where do you see yourself after this internship?", [],
    ["Interests you want to explore", "Skills and experience you hope to gain", "Connection to realistic next steps"],
    "Situation: your current interests. Task: what you want to explore. Action: how this internship helps you learn. Result: possible next steps, with room to change.",
    ["What would help you decide on your next step?", "Which skill would you most like to leave with?"]),
  // Technical: software
  q("t-sw-walkthrough", "technical", "Walk me through how a project you built is put together.", ["software"],
    ["Problem and main components", "Data flow and component responsibilities", "Design trade-offs and limitations"],
    "Problem: who the project serves and its constraints. Approach: components and a request or data flow. Trade-offs: one design choice, limitation, and possible improvement.",
    ["What happens when one component fails?", "Which design choice would you revisit?"]),
  q("t-sw-debug", "technical", "How do you debug a problem you can't reproduce?", ["software"],
    ["Observed symptoms and reproduction clues", "Hypotheses tested with logs or evidence", "Safe fix and regression checks"],
    "Problem: symptoms, impact, and missing reproduction steps. Approach: gather evidence, test hypotheses, and isolate a cause. Trade-offs: a safe mitigation versus a deeper fix.",
    ["What information would you collect first?", "How would you verify a fix without a reliable reproduction?"]),
  q("t-sw-hashmap", "technical", "When would you use a hash map instead of a list?", ["software"],
    ["Key lookup versus ordered access", "Time complexity and memory cost", "Duplicates and ordering requirements"],
    "Problem: the access pattern and data requirements. Approach: compare key lookup with list traversal. Trade-offs: memory, ordering, collisions, and duplicate keys.",
    ["When would a list be simpler?", "What can make hash map lookup slower than expected?"]),
  q("t-sw-complexity", "technical", "What is Big-O notation? Give an example from code you've written.", ["software"],
    ["Input size and growth of work", "Time and space complexity", "Concrete example and practical limits"],
    "Problem: define the input size. Approach: count how work or memory grows using an example. Trade-offs: worst-case growth versus constants and real input sizes.",
    ["How would your example behave with ten times the input?", "Could you trade memory for speed?"]),
  q("t-sw-testing", "technical", "How do you decide what to test?", ["software"],
    ["User impact and failure risks", "Boundaries and meaningful test cases", "Unit and integration test trade-offs"],
    "Problem: identify important behavior and failure risks. Approach: test normal cases, boundaries, and integration points. Trade-offs: confidence, maintenance, and test speed.",
    ["Which test would you write first?", "What would you choose not to test?"]),
  q("t-sw-git", "technical", "How do you use Git on a team: branches, reviews, and conflicts?", ["software"],
    ["Small branches and clear commits", "Review and checks before merging", "Conflict resolution with verification"],
    "Problem: several people changing shared code. Approach: small branches, reviews, and checks. Trade-offs: keeping changes current while resolving conflicts without losing work.",
    ["How would you resolve a conflict in unfamiliar code?", "What makes a change easier to review?"]),
  q("t-sw-api", "technical", "Design a simple API for a to-do list app.", ["software"],
    ["Resources and request operations", "Validation and useful error responses", "Ownership and access control"],
    "Problem: define users and to-do operations. Approach: resources, requests, responses, validation, and access checks. Trade-offs: simplicity, pagination, and concurrent updates.",
    ["How would you stop users reading another person's tasks?", "What response would you return for invalid input?"]),
  // Technical: data
  q("t-data-joins", "technical", "What's the difference between an inner join and a left join?", ["data"],
    ["Matching keys and row retention", "Unmatched rows and null values", "Duplicate keys and row counts"],
    "Problem: combine two tables by a key. Approach: use a small example to compare matching rows and retained left rows. Trade-offs: missing matches, duplicate keys, and unexpected row counts.",
    ["What happens when the right table has duplicate keys?", "When would a left join be useful?"]),
  q("t-data-messy", "technical", "How do you handle missing or messy data?", ["data"],
    ["Missing values and quality checks", "Cleaning choices and assumptions", "Validation and effect on analysis"],
    "Problem: understand the source and quality issues. Approach: inspect, clean, and validate while preserving the original. Trade-offs: dropping, imputing, or keeping missing values and their bias.",
    ["How would you decide whether to fill a missing value?", "How would you check that cleaning did not distort the result?"]),
  q("t-data-metric", "technical", "How would you pick a metric to measure a feature's success?", ["data"],
    ["User outcome and feature goal", "Metric definition and data source", "Guardrails and misleading incentives"],
    "Problem: define the user outcome the feature should change. Approach: choose a measurable metric, source, and comparison. Trade-offs: noisy proxies, guardrails, and incentives.",
    ["What could improve this metric while making the experience worse?", "How soon would you expect a useful signal?"]),
  q("t-data-ab", "technical", "How does an A/B test work, and what can go wrong?", ["data"],
    ["Hypothesis and random assignment", "Success metric and sample size", "Bias and uncertainty in results"],
    "Problem: define a testable hypothesis. Approach: randomly assign comparable groups and measure a planned outcome. Trade-offs: sample size, runtime, bias, and uncertainty.",
    ["Why can stopping a test early be misleading?", "What would you check before trusting the result?"]),
  q("t-data-explain", "technical", "Explain an analysis you did to someone non-technical.", ["data"],
    ["Audience question and decision", "Simple explanation of evidence", "Recommendation and uncertainty"],
    "Problem: the audience's question and decision. Approach: explain the evidence with a plain example or visual. Trade-offs: simplify details while keeping uncertainty and limits clear.",
    ["How did you check that the audience understood?", "What caveat was most important to explain?"]),
  q("t-data-overfit", "technical", "What is overfitting, and how do you spot it?", ["data"],
    ["Training performance versus unseen data", "Validation split and data leakage", "Model complexity and generalization"],
    "Problem: strong training results that fail on new data. Approach: compare training and validation performance and check leakage. Trade-offs: complexity, regularization, and available data.",
    ["How could data leakage hide overfitting?", "What change would you try first?"]),
  // Technical: design
  q("t-design-process", "technical", "Walk me through your design process on one project.", ["design"],
    ["User problem and project constraints", "Research and iteration on options", "Validation and design trade-offs"],
    "Problem: user needs and constraints. Approach: research, explore alternatives, prototype, and validate. Trade-offs: a decision shaped by evidence and what you would improve.",
    ["Which finding changed your design?", "What did you choose not to build?"]),
  q("t-design-research", "technical", "How do you find out what users need?", ["design"],
    ["Research question and participant selection", "Observation and unbiased questions", "Patterns and validation of findings"],
    "Problem: the user need you want to understand. Approach: choose participants, ask neutral questions, and observe behavior. Trade-offs: research depth, time, and sampling bias.",
    ["How would you avoid leading a participant?", "What would you do if interviews and behavior disagreed?"]),
  q("t-design-critique", "technical", "How do you respond to critique of your work?", ["design"],
    ["Design goal and evidence", "Clarifying feedback and different viewpoints", "Iteration and validation of changes"],
    "Problem: connect critique to the user goal. Approach: clarify feedback, explain evidence, and explore a revision. Trade-offs: competing viewpoints and what to validate before changing.",
    ["What if you disagree with the critique?", "How would you know a revision helped?"]),
  q("t-design-redo", "technical", "Tell me about a design decision you'd make differently now.", ["design"],
    ["Original decision and constraints", "New evidence or overlooked needs", "Alternative and expected trade-offs"],
    "Problem: the original goal and constraints. Approach: explain your decision and the evidence you have now. Trade-offs: a better alternative and how you would validate it.",
    ["What information would have changed your decision earlier?", "What would you preserve from the original design?"]),
  q("t-design-access", "technical", "How do you make a design accessible?", ["design"],
    ["Different user needs and barriers", "Keyboard navigation and readable content", "Assistive technology and user testing"],
    "Problem: identify who might face barriers. Approach: plan accessible interaction, readable content, and checks with assistive technology. Trade-offs: prioritize barriers while validating with users.",
    ["How would someone complete the task without a mouse?", "How would you test beyond an automated check?"]),
  // Technical: product
  q("t-pm-backlog", "technical", "How would you prioritize a long list of feature requests?", ["product"],
    ["User needs and desired outcomes", "Impact effort and dependencies", "Priorities and stakeholder communication"],
    "Problem: clarify the outcome behind requests. Approach: compare impact, effort, evidence, and dependencies. Trade-offs: explain priorities and what you defer.",
    ["How would you handle an urgent request from a senior stakeholder?", "When would you change the priorities?"]),
  q("t-pm-improve", "technical", "What's a product you love, and how would you improve it?", ["product"],
    ["Target user and unmet need", "Proposed change and alternatives", "Success metric and possible downsides"],
    "Problem: choose a specific user and unmet need. Approach: propose a focused improvement and how to test it. Trade-offs: alternatives, costs, and possible harm to existing users.",
    ["Who might dislike your change?", "What evidence would you seek before building it?"]),
  q("t-pm-measure", "technical", "How would you know whether a new feature worked?", ["product"],
    ["Feature goal and success metric", "Baseline and meaningful comparison", "Guardrails and uncertainty"],
    "Problem: define the intended outcome. Approach: compare a clear metric with a baseline or control. Trade-offs: uncertainty, unintended effects, and how long to measure.",
    ["Which guardrail would stop you from rolling the feature out?", "What if usage rises but satisfaction falls?"]),
  q("t-pm-tradeoff", "technical", "Engineering and design disagree. How do you help them decide?", ["product"],
    ["Shared goal and competing constraints", "Evidence and options from both teams", "Decision criteria and follow-through"],
    "Problem: clarify the shared goal and each team's constraints. Approach: compare options using evidence and agreed criteria. Trade-offs: explain the decision and how to revisit it.",
    ["What if there is not enough evidence to decide?", "How would you keep the team aligned after the decision?"]),
  // Technical: any field
  q("t-gen-tools", "technical", "Which tools from the job posting have you used, and how?", [],
    ["Tools and level of experience", "Concrete task and personal contribution", "Limitations and learning plan"],
    "Problem: connect a listed tool to a real task. Approach: explain what you did and the result. Trade-offs: state experience honestly and how you would learn unfamiliar tools.",
    ["Which part did you do yourself?", "How would you get started with a tool you have not used?"]),
  q("t-gen-explain", "technical", "Explain a concept from your coursework in simple words.", [],
    ["Plain definition and purpose", "Concrete example or analogy", "Limitations and common misunderstanding"],
    "Problem: name the concept and why it is useful. Approach: a plain definition and concrete example. Trade-offs: explain where the example or concept stops being useful.",
    ["Could you give an everyday example?", "What is a common misunderstanding about it?"]),
  q("t-gen-new", "technical", "How would you approach a problem you've never seen before?", [],
    ["Problem definition and constraints", "Smaller steps and relevant resources", "Validation and when to ask for help"],
    "Problem: clarify the goal, constraints, and unknowns. Approach: break the work down, research, and test a small step. Trade-offs: time spent exploring versus asking for help.",
    ["How would you know your approach was working?", "When would you ask someone for help?"]),
  // Internship logistics
  q("l-dates", "logistics", "Which dates are you available, and for how long?", [],
    ["Earliest start and latest end dates", "Available term length", "Known schedule constraints and flexibility"],
    "State your start and end dates, the length of term you can commit to, and any known constraints or flexibility.",
    ["Are those dates fixed by your school?", "Could you extend the term if needed?"]),
  q("l-start", "logistics", "When could you start?", [],
    ["Earliest realistic start date", "Notice or school commitments", "Flexibility and confirmation needed"],
    "Give your earliest realistic start date, explain commitments that affect it, and say what flexibility you can confirm.",
    ["What would need to happen before you could start?", "Would a later start date work for you?"]),
  q("l-place", "logistics", "Are you open to on-site, hybrid, or remote work?", [],
    ["Preferred work arrangement", "Location and commuting availability", "Practical constraints and flexibility"],
    "State the arrangements you can work, your location or commute constraints, and the details you would need to confirm.",
    ["How often could you come to the office?", "Would you need to move for this role?"]),
  q("l-hours", "logistics", "How many hours a week could you work during the term?", [],
    ["Weekly availability and schedule", "Classes or other commitments", "Exam periods and communication"],
    "Give a realistic weekly hour range, explain fixed commitments, and flag periods when your availability changes.",
    ["Would your availability change during exams?", "Which days or hours are fixed commitments?"]),
  q("l-pay", "logistics", "What pay are you expecting? Look up typical rates for the role first.", [],
    ["Researched range for comparable roles", "Currency and hourly or salary basis", "Flexibility and total compensation"],
    "Give a researched range with currency and pay period, explain the comparison briefly, and ask about the role's budget and benefits.",
    ["What information did you use to choose that range?", "How do benefits or location affect your expectations?"]),
  q("l-authorization", "logistics", "Do you have the work authorization this role needs?", [],
    ["Current eligibility for this location", "Relevant dates or restrictions", "Sponsorship needs and confirmation"],
    "State what you know about your eligibility, relevant dates or restrictions, and any sponsorship or confirmation you need; avoid guessing.",
    ["Would you need sponsorship during or after the internship?", "Is there anything you need to confirm before accepting?"]),
  q("l-school", "logistics", "Does your school need this for credit or a co-op term? What paperwork is involved?", [],
    ["Credit or co-op requirements", "Required paperwork and deadlines", "School contact and employer responsibilities"],
    "Explain whether the placement is for credit, name the required documents and deadlines, and clarify what your school needs from the employer.",
    ["Who at your school can confirm the requirements?", "What would the employer need to complete?"]),
  q("l-relocation", "logistics", "Would you need help with relocation or housing?", [],
    ["Need to move and feasible timing", "Housing or travel support needed", "Budget constraints and available options"],
    "State whether you need to move, your feasible timeline, and the housing or travel support you would need to make it work.",
    ["When would you need to arrange housing?", "What support would make relocation feasible?"]),
  q("l-other-offers", "logistics", "Are you interviewing elsewhere? It's fine to say yes.", [],
    ["Honest high-level interview status", "Decision deadlines that affect timing", "Interest in this opportunity"],
    "Share only the process details you are comfortable sharing, state any real decision deadlines, and explain your interest in this role.",
    ["Is there a decision deadline we should know about?", "What matters most when you compare opportunities?"]),
  q("l-references", "logistics", "Who could you list as references?", [],
    ["References who know your work", "Relationship and relevant experience", "Consent and contact availability"],
    "Name the kinds of people who can discuss your work, explain how they know you, and confirm their permission before sharing contact details.",
    ["Which reference has seen you work on a team?", "Have you checked that they are available to be contacted?"]),
  // Questions to ask them
  q("a-typical-day", "ask", "What does a typical day look like for an intern here?", [],
    ["Daily responsibilities and balance of work", "Collaboration and independent time", "Why the routine fits your learning needs"],
    "Ask about a typical day, then explain why understanding the balance of work and collaboration matters to your learning.",
    ["Which part of that day interests you most?", "What would help you feel prepared for that routine?"]),
  q("a-success", "ask", "What would a great internship look like by the end?", [],
    ["Expected outcomes by the end", "How progress and success are evaluated", "Why clear expectations help you contribute"],
    "Ask what success looks like and how it is assessed; explain why clear expectations would help you focus your effort.",
    ["What would you hope to achieve by the end?", "How do you like to track your progress?"]),
  q("a-mentor", "ask", "Who would I work with most, and how often would we meet?", [],
    ["Main collaborators and mentor", "Meeting cadence and access to support", "Why guidance helps your development"],
    "Ask who you would learn from and how often you would meet; explain the kind of support that helps you develop.",
    ["What kind of mentoring helps you most?", "How do you prepare for a check-in?"]),
  q("a-project", "ask", "What kind of project might I work on?", [],
    ["Likely project scope and ownership", "Users or team needs the project serves", "Why the project supports your learning goals"],
    "Ask for an example project and the intern's ownership; explain why the scope and user impact matter to your learning goals.",
    ["What kind of project would you most like to try?", "How would you approach a project outside your experience?"]),
  q("a-feedback", "ask", "How does the team share feedback?", [],
    ["How and when feedback is shared", "Opportunities to apply feedback", "Why regular feedback helps you improve"],
    "Ask how feedback is shared and revisited; explain why timely, practical feedback helps you improve your work.",
    ["How do you prefer to receive feedback?", "Can you share feedback you acted on recently?"]),
  q("a-past-interns", "ask", "What have past interns gone on to do?", [],
    ["Examples of past intern contributions", "Learning and career paths afterward", "Why those examples inform your expectations"],
    "Ask about past interns' work and next steps; explain why real examples help you understand learning and growth opportunities.",
    ["Which of those paths interests you?", "What would you want to learn from a past intern?"]),
  q("a-challenge", "ask", "What's the biggest challenge the team is working on?", [],
    ["Current team problem and impact", "How an intern could contribute", "Why the challenge interests you"],
    "Ask about a current challenge and where an intern could help; explain the connection to your interests or experience.",
    ["What part of that challenge would you want to learn about?", "How would you start contributing?"]),
  q("a-enjoy", "ask", "What do you enjoy most about working here?", [],
    ["Personal example of team experience", "Culture and day-to-day working habits", "Why that experience matters to your fit"],
    "Ask what the interviewer enjoys, invite a concrete example, and explain what you hope to understand about working with the team.",
    ["What helps you enjoy working with a team?", "Which part of our conversation stood out to you?"]),
  q("a-return", "ask", "Do interns sometimes get return offers?", [],
    ["Whether return opportunities exist", "Criteria and timing of decisions", "Why longer-term options interest you"],
    "Ask whether return opportunities exist and how decisions are made; explain your interest in possible longer-term growth without assuming an offer.",
    ["What interests you about continuing after an internship?", "What would help you decide whether to return?"]),
  q("a-next", "ask", "What are the next steps, and when should I expect to hear back?", [],
    ["Remaining interview steps", "Expected timeline and contact person", "Why clarity helps you plan"],
    "Ask about the remaining steps, timing, and best contact; explain any planning deadline you need to coordinate.",
    ["Is there a timeline you need us to know about?", "Is there anything else you would like us to clarify?"]),
  q("a-tools", "ask", "Which tools and languages does the team use day to day?", [],
    ["Tools used for everyday tasks", "How tool choices support the work", "Why preparation and learning matter to you"],
    "Ask which tools support the team's daily work and how newcomers learn them; explain why that context helps you prepare.",
    ["Which of those tools have you used?", "How would you learn a tool that is new to you?"]),
  q("a-new-people", "ask", "How does the team help people who are new to the field?", [],
    ["Onboarding and early expectations", "Support for questions and learning", "Why a safe learning environment matters"],
    "Ask how newcomers get started and ask for help; explain why clear early expectations and approachable support matter to your learning.",
    ["What helps you settle into a new team?", "How do you ask for help when you are unsure?"])
]);

const BY_ID = new Map(QUESTION_BANK.map(question => [question.id, question]));
export const questionById = id => BY_ID.get(id) || null;

/* Keywords that tie a role to a technical track. A role can match more than one ("Data Engineer"). */
const ROLE_TAGS = [
  ["software", /\b(software|developer|engineer(ing)?|swe|back-?end|front-?end|full[- ]?stack|web|mobile|devops|qa|test(ing)?|programmer|embedded|firmware)\b/i],
  ["data", /\b(data|analyst|analytics|machine learning|ml|scien(ce|tist)|statistic(s|al)?|ai|bi)\b/i],
  ["design", /\b(design(er)?|ux|ui|figma|graphic|interaction)\b/i],
  ["product", /\b(product (manager|management|owner|analyst)|pm|apm)\b/i]
];

/** The technical tracks a role title points to, e.g. "Data Engineering Intern" -> ["software", "data"]. */
export function roleTags(role) {
  const title = String(role ?? "");
  return ROLE_TAGS.filter(([, pattern]) => pattern.test(title)).map(([tag]) => tag);
}

/* Which kinds of question matter most at each stage. Earlier groups are drawn from first. */
const STAGE_GROUPS = {
  SAVED: ["behavioral", "logistics", "technical", "ask"],
  APPLIED: ["behavioral", "technical", "ask", "logistics"],
  INTERVIEW: ["technical", "behavioral", "ask", "logistics"],
  OFFER: ["logistics", "ask", "behavioral", "technical"],
  REJECTED: ["behavioral", "technical", "ask", "logistics"]
};

/** Every question that applies to the role, by group: technical questions for the role's tracks
 *  (tagged ones first), plus the any-field ones. No track matched means only the any-field ones. */
export function questionsByGroup(role) {
  const tags = roleTags(role);
  const groups = Object.fromEntries(QUESTION_GROUPS.map(group => [group.id, []]));
  for (const question of QUESTION_BANK) {
    if (question.group === "technical" && question.tags.length && !question.tags.some(tag => tags.includes(tag))) continue;
    groups[question.group].push(question);
  }
  groups.technical.sort((left, right) => (right.tags.length > 0) - (left.tags.length > 0));
  return groups;
}

/**
 * Questions for one application, most useful first. The stage decides which groups lead (technical
 * before an interview, logistics once there's an offer); groups take turns so a short list is
 * still mixed. With `toPractice`, practiced questions are left out and "stuck" ones come first.
 * `limit` caps the list (default: all of them).
 */
export function questionsFor({ role, status, interview } = {}, { limit = Infinity, toPractice = false } = {}) {
  const groups = questionsByGroup(role);
  const order = STAGE_GROUPS[status] || STAGE_GROUPS.APPLIED;
  const progress = cleanInterview(interview);
  const state = question => progress[question.id]?.status || "new";
  const queues = order.map(group => groups[group].filter(question => !toPractice || state(question) !== "practiced"));
  const picked = [];
  while (queues.some(queue => queue.length)) {
    for (const queue of queues) if (queue.length) picked.push(queue.shift());
  }
  const ranked = toPractice
    ? [...picked.filter(question => state(question) === "stuck"), ...picked.filter(question => state(question) !== "stuck")]
    : picked;
  return ranked.slice(0, Number.isFinite(limit) ? Math.max(0, limit) : undefined);
}

/**
 * Counts for a set of progress records (one per question in scope; a missing record is "new").
 * Returns { total, practiced, stuck, fresh, toPractice, percent } where percent is practiced/total.
 */
export function interviewProgress(entries) {
  const records = Array.isArray(entries) ? entries : [];
  const count = status => records.filter(record => (INTERVIEW_STATUSES.includes(record?.status) ? record.status : "new") === status).length;
  const total = records.length;
  const practiced = count("practiced");
  const stuck = count("stuck");
  return { total, practiced, stuck, fresh: total - practiced - stuck, toPractice: total - practiced, percent: total ? Math.round((practiced * 100) / total) : 0 };
}

/**
 * One application's prep at a glance: the progress over every question that applies to it, the
 * next question to practice (stuck first), and a one-line summary like "4 of 40 practiced, 1 stuck".
 */
export function interviewSummary(application) {
  const progress = cleanInterview(application?.interview);
  const scope = questionsFor(application || {});
  const counts = interviewProgress(scope.map(question => progress[question.id] || { status: "new" }));
  const [next = null] = questionsFor(application || {}, { limit: 1, toPractice: true });
  const notes = Object.values(progress).filter(record => record.note).length;
  const text = `${counts.practiced} of ${counts.total} practiced${counts.stuck ? `, ${counts.stuck} stuck` : ""}`;
  return { ...counts, notes, next, text };
}

/** The progress map after marking one question. Choosing the status it already has clears it back
 *  to "new" (so the buttons toggle). The result is cleaned, ready to save. */
export function withQuestionStatus(interview, questionId, status) {
  if (!BY_ID.has(questionId) || !INTERVIEW_STATUSES.includes(status)) return cleanInterview(interview);
  const current = cleanInterview(interview);
  const record = current[questionId] || { status: "new" };
  return cleanInterview({ ...current, [questionId]: { ...record, status: record.status === status ? "new" : status } });
}

/** The progress map after editing one question's note (an empty note removes it). */
export function withQuestionNote(interview, questionId, note) {
  if (!BY_ID.has(questionId)) return cleanInterview(interview);
  const current = cleanInterview(interview);
  const record = current[questionId] || { status: "new" };
  return cleanInterview({ ...current, [questionId]: { ...record, note: typeof note === "string" ? note : "" } });
}
