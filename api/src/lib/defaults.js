'use strict';
/**
 * Starter content. Modules are created once on first run so a new
 * environment is usable right away; after that they live in the database
 * and are edited in the Trainings tab.
 *
 * IMPORTANT: Safety must review every question before it is used with crews.
 */

const DEFAULT_PTS = { checkin: 10, answer: 10, correct: 100, speed: 50, word: 5, wordCap: 3, ask: 10 };

const Q = (id, topic, text, options, correct, es) => ({ id, topic, text, options, correct, ...(es ? { es } : {}) });

const TAILGATE = [
  Q('q1', 'Trenching & Excavation', 'At what depth does a trench need a protective system (unless it is in stable rock)?', ['4 feet', '5 feet', '8 feet', '10 feet'], 1,
    { text: '¿A qué profundidad necesita una zanja un sistema de protección (excepto en roca estable)?', options: ['4 pies', '5 pies', '8 pies', '10 pies'] }),
  Q('q2', 'Trenching & Excavation', 'In a trench 4 feet or deeper, a ladder or other exit must be within how far of every worker?', ['10 feet', '50 feet', '25 feet', '100 feet'], 2,
    { text: 'En una zanja de 4 pies o más, ¿a qué distancia de cada trabajador debe haber una escalera u otra salida?', options: ['10 pies', '50 pies', '25 pies', '100 pies'] }),
  Q('q3', 'Trenching & Excavation', 'How far back from the trench edge do spoil piles need to be kept?', ['At least 6 inches', 'At least 1 foot', 'There is no requirement', 'At least 2 feet'], 3,
    { text: '¿A qué distancia del borde de la zanja se debe mantener el material excavado?', options: ['Al menos 6 pulgadas', 'Al menos 1 pie', 'No hay requisito', 'Al menos 2 pies'] }),
  Q('q4', 'Trenching & Excavation', 'Who has to inspect a trench every day before work starts?', ['A competent person', 'The newest crew member', 'The equipment operator', "The owner's inspector"], 0,
    { text: '¿Quién debe inspeccionar la zanja todos los días antes de empezar a trabajar?', options: ['Una persona competente', 'El trabajador más nuevo', 'El operador del equipo', 'El inspector del dueño'] }),
  Q('q5', 'Heat Illness', 'Working in the heat, how often should you drink water even if you are not thirsty?', ['Only on breaks', 'Every 15 to 20 minutes', 'Once an hour', 'Only when you feel thirsty'], 1,
    { text: 'Trabajando en el calor, ¿cada cuánto debes tomar agua aunque no tengas sed?', options: ['Solo en los descansos', 'Cada 15 a 20 minutos', 'Una vez por hora', 'Solo cuando tengas sed'] }),
  Q('q6', 'Lockout/Tagout', 'Who is allowed to remove your lockout lock?', ['Your foreman', 'Anyone on the crew once the work is done', 'Only you, the person who put it on', 'The equipment operator'], 2,
    { text: '¿Quién puede quitar tu candado de bloqueo?', options: ['Tu capataz', 'Cualquiera del equipo cuando termine el trabajo', 'Solo tú, la persona que lo puso', 'El operador del equipo'] })
];

function seedModules() {
  const c = (o) => JSON.parse(JSON.stringify(o));
  return [
    { id: 'm-tail', code: 'TAIL', name: 'Tailgate Safety: Trenching & Heat', desc: 'Short field refresher on trenching and heat illness.', expires: 0, pass: 0, hcssCourseCode: '', questions: c(TAILGATE) },
    { id: 'm-dd', code: 'DD', name: 'Defensive Driving', desc: 'Required for anyone who drives a company vehicle.', expires: 12, pass: 80, hcssCourseCode: '', questions: [
      Q('dd1', 'Equipment & Traffic', 'In good conditions, how much following distance should you keep in a pickup?', ['One car length', 'About 1 second', 'At least 3 to 4 seconds', '10 feet'], 2),
      Q('dd2', 'Equipment & Traffic', 'Before backing a work truck, what should you do first?', ['Honk twice', 'Get out and walk around it', 'Turn up the radio', 'Back up slowly and feel for it'], 1),
      Q('dd3', 'Equipment & Traffic', 'When is it OK to text while driving a company vehicle?', ['At a red light', 'On a straight, empty road', 'Never. Pull over and park first', 'When cruise control is on'], 2),
      Q('dd4', 'Equipment & Traffic', 'A dust storm drops visibility to near zero on the highway. What do you do?', ['Turn on hazards and keep driving slowly', 'Pull off as far as you can, turn off all lights, foot off the brake', 'Stop in your lane', 'Follow the taillights ahead of you'], 1),
      Q('dd5', 'Equipment & Traffic', 'Who has to wear a seat belt in a company vehicle?', ['Only the driver', 'Everyone, every trip', 'Only on the highway', 'Only in the front seat'], 1),
      Q('dd6', 'Equipment & Traffic', 'What causes most rear-end collisions?', ['Bad weather', 'Following too closely', 'Mechanical failure', 'Night driving'], 1)
    ] },
    { id: 'm-onb', code: 'ONB', name: 'New Hire Onboarding', desc: 'First-week orientation for every new employee-owner.', expires: 0, pass: 0, hcssCourseCode: '', questions: [
      Q('on1', 'ESOP & Benefits', 'Who owns KE&G?', ['A private equity firm', 'One family', 'The employees, through the ESOP', 'A national contractor'], 2),
      Q('on2', 'ESOP & Benefits', 'What does being employee-owned mean for you?', ['Free lunch on Fridays', 'When the company does well, your retirement account grows', 'You get a company truck', 'Nothing changes'], 1),
      Q('on3', 'Reporting & Near Misses', 'You see an unsafe condition on site. What do you do?', ['Wait until the end of the shift', 'Stop and report it to your foreman right away', 'Fix it yourself and move on', 'Post it in the group chat'], 1),
      Q('on4', 'Reporting & Near Misses', 'You get a small cut on the job. Who do you tell?', ['Nobody if it is small', 'Your foreman or supervisor, right away', 'Only HR, at the end of the week', 'A coworker'], 1),
      Q('on5', 'Other', 'KE&G has been building the Southwest since what year?', ['1972', '1990', '2005', '2014'], 0),
      Q('on6', 'Other', "What is KE&G's tagline?", ['Built Tough', 'Constructing Legacies', 'Moving Dirt Since Day One', 'Southwest Strong'], 1)
    ] },
    { id: 'm-osha', code: 'OSHA10', name: 'OSHA 10 Construction Review', desc: 'Knowledge check that goes with the OSHA 10 course. The official DOL card still comes from the authorized OSHA Outreach trainer.', expires: 60, pass: 70, hcssCourseCode: '', questions: [
      Q('os1', 'Fall Protection', 'In construction, fall protection is generally required at what height?', ['4 feet', '6 feet', '10 feet', '15 feet'], 1),
      Q('os2', 'Other', 'What are the "Focus Four" hazards in construction?', ['Heat, noise, dust, and chemicals', 'Falls, caught-in or between, struck-by, and electrocution', 'Fire, flood, wind, and lightning', 'Slips, trips, cuts, and burns'], 1),
      Q('os3', 'Fall Protection', 'How far above the landing should the side rails of an extension ladder reach?', ['1 foot', '2 feet', '3 feet', '5 feet'], 2),
      c(TAILGATE[0]), c(TAILGATE[2]),
      Q('os6', 'Reporting & Near Misses', 'If you report a safety hazard, what protects you under OSHA?', ['Nothing', 'Protection from retaliation by your employer', 'A cash reward', 'A transfer to another crew'], 1)
    ] }
  ];
}

/** Demo people and rosters. Only loaded when SEED_DEMO=true (local dev). */
function demoPeople() {
  const F = ['Miguel', 'Jesse', 'Ana', 'Tyler', 'Rosa', 'Daniel', 'Luis', 'Brandon', 'Maria', 'Cody', 'Adrian', 'Kayla', 'Jose', 'Travis', 'Gabriel', 'Erica', 'Ramon', 'Dustin', 'Veronica', 'Isaac', 'Hector', 'Shane', 'Lorena', 'Marcus', 'Ruben', 'Amber', 'Victor', 'Colton', 'Yesenia', 'Armando', 'Derek', 'Alicia'];
  const L = ['Ramirez', 'Thompson', 'Valenzuela', 'Brooks', 'Ortega', 'Lucero', 'Hayes', 'Moreno', 'Castillo', 'Whitfield', 'Duarte', 'Fischer', 'Navarro', 'Ellison', 'Salazar', 'Pruitt', 'Gallegos', 'Reyes', 'Kline', 'Montoya'];
  const C = ['Infrastructure', 'Sierra Vista', 'Utility', 'JOC', 'Commercial', 'Development', 'Mining'];
  const out = [];
  for (let i = 0; i < 64; i++) out.push({ id: String(10001 + i), name: F[i % F.length] + ' ' + L[(i * 7 + Math.floor(i / F.length) * 3) % L.length], crew: C[i % C.length] });
  return out;
}
function demoRosters(people) {
  const ids = (f) => people.filter(f).map((p) => p.id);
  return [
    { id: 'r-sv', name: 'Sierra Vista Field Crew', created: '2026-09-15', members: ids((p, i) => p.crew === 'Sierra Vista' || i % 9 === 4) },
    { id: 'r-util', name: 'Utility Crew A', created: '2024-03-01', members: ids((p, i) => p.crew === 'Utility' || i % 11 === 1) },
    { id: 'r-fleet', name: 'Fleet Drivers', created: '2025-09-01', members: ids((p, i) => i % 3 === 0) },
    { id: 'r-nh', name: 'November New Hires', created: '2026-11-01', members: ids((p, i) => i >= 56) }
  ];
}

module.exports = { DEFAULT_PTS, seedModules, demoPeople, demoRosters };
