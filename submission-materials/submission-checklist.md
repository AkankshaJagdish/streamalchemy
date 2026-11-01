# StreamAlchemy — submission checklist

## Repository
- [ ] Confirm repository URL: https://github.com/AkankshaJagdish/streamalchemy
- [ ] Confirm repository visibility and Devpost judging access.
- [ ] Confirm README, LICENSE, package manifest/lockfile, `.env.example`, `.gitignore`, `src/`, `public/`, `tests/` and `submission-materials/` are present.
- [ ] Confirm no `.env`, Twitch User Access Token, Client Secret, private account data or temporary recordings are committed.
- [ ] Run the clean install and complete automated suite from a clean checkout.
- [ ] Review CI status on the final commit.

## Live product verification
- [ ] Test with the actual Twitch broadcaster channel and a separate viewer.
- [ ] Confirm real chat `!curse gravity` trigger and overlay activation.
- [ ] Confirm 30-second timer and expiry/reset.
- [ ] Confirm actual Channel Points reward trigger and same effect.
- [ ] Confirm a different reward ID does not activate the curse.
- [ ] Confirm overlay reconnect preserves the original expiry timestamp.
- [ ] Confirm OBS Browser Source renders correctly.
- [ ] Record and preserve evidence. Do not mark this section complete based on mocked tests.

## Codex requirement
- [ ] Open the primary Codex development thread and run `/status`.
- [ ] Copy the real session ID from that command. Do not invent one or use a GitHub commit ID as the session ID.
- [ ] Capture the actual Codex thread and a genuine code diff for the demo.
- [ ] Enter the Codex session ID in the Devpost submission form.

## Video and written submission
- [ ] Record the actual Twitch channel, live chat command and overlay activation.
- [ ] Show the 30-second countdown and expiry.
- [ ] Show the actual Channel Points redemption and corresponding effect.
- [ ] Show Codex development and code changes.
- [ ] Use only footage/music/assets that the entrant owns or has permission to use.
- [ ] Keep video under three minutes and upload it to YouTube with visibility suitable for judging (public or unlisted, not private).
- [ ] Include the project description and testing instructions.
- [ ] Explain current limitations, including no automatic redemption fulfillment with the current scopes.

## Final decision
- [ ] Mark ready for submission only after all mandatory live Twitch and OBS checks are complete and the final repository/video/session details have been independently verified.
