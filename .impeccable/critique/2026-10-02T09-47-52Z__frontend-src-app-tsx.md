---
target: frontend/src/App.tsx
total_score: 31
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-10-02T09-47-52Z
slug: frontend-src-app-tsx
---
Method: dual-agent (A: design-review · B: detector-evidence)

#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 4 | Strong status chips, loading states, state labels, and session flow |
| 2 | Match System / Real World | 3 | Secure system language is honest, but some jargon is too protocol-heavy for ordinary voters |
| 3 | User Control and Freedom | 2 | Review and escape routes exist, but the app stresses irreversibility and loss more than control |
| 4 | Consistency and Standards | 4 | The app shell and token system are coherent and disciplined |
| 5 | Error Prevention | 3 | Good prevention around passphrases, review, and election state gating |
| 6 | Recognition Rather Than Recall | 3 | Visible state labels help, but the app still demands critical secret recall |
| 7 | Flexibility and Efficiency | 2 | It prioritizes correctness over speed and shortcuts |
| 8 | Aesthetic and Minimalist Design | 4 | The monochrome system is coherent, minimal, and confident |
| 9 | Error Recovery | 3 | Warnings diagnose failures appropriately, but recovery guidance is thin |
| 10 | Help and Documentation | 3 | Inline guidance is useful, though it remains caution-heavy |
| **Total** | | **31/40** | **Good** |

#### Design Specificity Verdict

**LLM assessment**: This interface is not category-interchangeable. It has a real visual and conceptual language: monochrome, glassy chrome, role-based navigation, explicit state pills, and a security-lab aesthetic. The app feels authored for a trust-heavy election product, not for a generic SaaS admin panel. The main weakness is not specificity; it is emotional fit. The design is specific to the protocol, but it is not yet specific to a confident voter journey. It explains risk with precision, but it does not yet calm or reassure the user enough to make the high-stakes act feel manageable.

**Deterministic scan**: The detector reported 10 findings total: 8 slop and 2 quality. The strongest repeated pattern was side-tab accent borders (`frontend/src/App.css:972, 1245, 2387, 2391, 2395, 2399`), which is consistent with a generic “AI SaaS” pattern. It also flagged gradient text (`frontend/src/App.css:1167`, `frontend/src/theme.css:233`) and one layout-transition issue (`frontend/src/App.css:1427`). One item, the brand mark, was a false positive: `frontend/src/components/Brand/ZvMark.tsx:3` is an inline SVG, not a broken image. The pattern signal is real, but it is not catastrophic: the product still has a coherent system and a distinctive security posture.

**Visual overlays**: No live browser overlay was created in this session, so there is no reliable user-visible overlay to inspect. The browser/manual path was unavailable for this run, and the critique is therefore grounded in source review plus detector evidence rather than a live rendered page.

#### Overall Impression
The system is intelligent, disciplined, and coherent. It has a real design system. It does not yet feel like a product people can trust with a civic act without nervousness. The biggest opportunity is not cosmetic; it is reducing the mental burden of the secret-management ritual and making the user journey feel calmer and more confident.

#### What's Working
- The app shell is disciplined and deliberate: skip link, semantic main region, focus handling, role gating, and hash-based navigation.
- The status language is strong. The UI communicates the system state clearly and helps users understand what is allowed, blocked, or pending.
- The monochrome design language is coherent and premium. It reads as serious and technical, which matches the product’s security posture.

#### Priority Issues
- **[P1] The secret-recovery story is too weak for a system that depends on unrecoverable secrets**
  - Why it matters: The product is built around account keys, ballot keys, passphrases, and reveal salts that the user may not recover. The app warns the user repeatedly, but it does not offer a reassuring recovery path or a low-stress backup strategy.
  - Fix: Reframe recovery as part of the user journey. Show a visible “Save and back up these values” section, explain what happens if a secret is lost, and make backup guidance a first-class part of the workflow.
  - Suggested command: /impeccable clarify

- **[P1] The process is still too protocol-heavy for an ordinary user**
  - Why it matters: The app asks the user to understand account key, ballot key, sealed key, ballot passphrase, and reveal salt before they can vote. That is a very high cognitive load for a civic action.
  - Fix: Reduce jargon or create guided explanations directly adjacent to each field, and favor “what should I do now?” language over system-lingo whenever possible.
  - Suggested command: /impeccable layout

- **[P2] The emotional journey feels cold and procedural rather than reassuring**
  - Why it matters: A high-stakes act like voting should feel calm and trustworthy. The current language reads more like a lab security ritual than a civic moment.
  - Fix: Tone down warning-heavy copy, place reassurance and confidence cues closer to the decision point, and bring the successful path into the same visual rhythm as the warnings.
  - Suggested command: /impeccable delight

- **[P2] The visual language leans generic-template in a few repeated patterns**
  - Why it matters: Side-tab borders and gradient text are not fatal, but they make the page feel more templated and less product-specific than the rest of the system.
  - Fix: Reduce the repeated left borders to subtle inset cues and convert gradient text to solid, weight-driven typography.
  - Suggested command: /impeccable polish

#### Persona Red Flags
- **Jordan (First-Timer)**: The app is likely to scare people before they even understand what they are doing. “Ballot passphrase,” “sealed key,” and “reveal salt” are all abstract concepts without a proper user frame; the app is asking for security literacy before onboarding.
- **Alex (Power User)**: The app is not especially efficient. There are no power-user shortcuts, and the experience is intentionally procedural. That is defensible but not efficient.
- **Non-technical voter**: The UI presents the product as a secure protocol, but not as a person-centered civic flow. This is an especially risky mismatch for a public election scenario.

#### Minor Observations
- The app’s status system is a genuine strength; it makes the election flow legible.
- The navigation and focus behavior are more polished than average; they support access for keyboard and assistive-tech users.
- The design system is clean and carefully tokenized.
- The product is honest about its constraints, and that honesty reflects good engineering judgement.

#### Questions to Consider
- If the app requires secret retention and no recovery path, why does the interface not treat backup guidance as the core experience rather than a warning?
- Is the product trying to prove it is secure, or help a person act confidently?
- What would the same flow look like if the user only had to understand one concept instead of four?

> **Trend for frontend-src-app (last 5 runs): First run for this target, no trend yet.**
> Wrote `.impeccable/critique/<filename>`.
