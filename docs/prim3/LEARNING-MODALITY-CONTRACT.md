# PRIM3 learning modality contract

Status: canonical curriculum architecture

PRIM3 uses the PRIM Method as its public learning model. One coherent curriculum is delivered through four complementary modalities.

## P Principles

Principles is the complete conventional course.

The learner must be able to complete the explanations, reading, vocabulary, examples, knowledge checks, assessments and certification aligned instruction without listening to a song, watching an episode or entering the game.

Every required Security Plus SY0 701 objective and Network Plus N10 009 objective must be fully taught in Principles. Relevant A Plus Core 1 220 1201 and Core 2 220 1202 precursor material is taught where it strengthens the learner foundation or overlaps the mandatory exams.

Principles is the authority for curriculum completion and objective mastery.

Internal PRIM cycle: Principles, Reasoning, Instruction, Mastery.

## R Rhythm

Rhythm is the music reinforcement layer.

Songs reinforce concepts already taught in Principles. Music may introduce memorable vocabulary, analogies, imagery, patterns and mental models, but a song never substitutes for conventional instruction and never creates Principles credit by itself.

A song concept is linked only when the canonical PRIM3 source material actually contains that concept.

Internal PRIM cycle: Patterns, Rhythm, Imagery, Memory.

## I Immersion

Immersion is the story reinforcement layer.

Episodes reinforce concepts through characters, pressure, consequences, decisions and narrative context. Story scenes may make an abstract concept easier to recognize and remember, but Immersion does not replace the complete explanation in Principles.

Internal PRIM cycle: Plot, Relevance, Immersion, Meaning.

## M Missions

Missions is the practical application layer and will be implemented through the PRIM3 video game.

Missions let the learner apply knowledge in controlled fictional, local, owned or explicitly authorized scenarios. Detailed mission and lab design is intentionally deferred until the game practice architecture is separately approved.

Missions never reduce the amount of conventional instruction required in Principles.

Internal PRIM cycle: Practice, Response, Interaction, Mastery.

## Primary learner language

The public explanation of PRIM should remain simple.

P Principles means Learn it.

R Rhythm means Remember it.

I Immersion means See it.

M Missions means Do it.

The nested PRIM cycles are secondary explanatory devices. They may appear inside a modality but must not compete with the primary four letter model on first exposure.

## Functional aliases

Older curriculum contracts and internal tools may still use LEARN, REMEMBER, WATCH and LAB as functional aliases. These names are compatibility vocabulary, not a competing public brand.

LEARN is the complete conventional course. LEARN maps to P Principles.

REMEMBER maps to R Rhythm. A song never substitutes for conventional instruction.

WATCH maps to I Immersion. WATCH does not replace the complete explanation in LEARN.

LAB maps to M Missions. Detailed lab design is intentionally deferred until the game practice architecture is separately approved.

The purpose remains one coherent curriculum through multiple forms of explanation, memory and application.

## Progress semantics

A concept is taught comprehensively in Principles and may satisfy several overlapping certification objectives.

The LMS must not force duplicate lessons merely because Security Plus, Network Plus and A Plus use different objective numbers for substantially overlapping knowledge.

Each canonical concept links to every certification objective it supports. Principles mastery credits every linked objective at the appropriate topic level.

Security Plus and Network Plus remain mandatory complete coverage targets. A Plus is a supporting precursor and overlap tracker rather than a PRIM3 completion gate.

Rhythm, Immersion and Missions have separate completion status. Their completion may be displayed and analyzed, but none of them substitutes for Principles mastery.

## Tracking contract

Principles progress is derived from the authenticated module progress records already stored by McCluster.

Rhythm, Immersion and Missions use the existing `mastery` JSON on the authenticated PRIM3 progress row for the first module of each PRIM3 source unit. That first module acts as the unit tracking anchor. This preserves one canonical learner record without creating a second backend.

The browser helper `window.PRIM3_TRACKING.recordModality(unitId, letter, completed, metadata)` is the integration point for the future music player, episode player and game runtime. Only R, I and M are manually recorded through that helper. P is derived from the required lesson and assessment state.

Objective progress is computed from the Security Plus, Network Plus and A Plus curriculum maps against Principles modules actually passed by the learner. Planned curriculum metadata alone never counts as learner mastery.

## Backend authority

Cloudflare remains the public API and authentication edge.

Supabase remains the learner state and durable data authority.

The McCluster VPS remains an asynchronous execution and analysis plane. It must not become a browser facing LMS backend or a competing learner database.

The VPS may later consume authorized Supabase learner progress through the existing McCluster Core job system for analytics, personalized review generation, curriculum gap analysis and morning or scheduled learning summaries. Any derived result must flow back through the canonical McCluster data plane rather than creating a shadow learner store.
