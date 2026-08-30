# AI Ad Brain — Creative, Video, Voice, and Local Generation

**Status:** Experimental pipeline; production hardening required  
**Last user-reported context:** August 2026

## Purpose

Use the EdgeXpert/local AI stack to create, evaluate, and improve Your AI Department and client ad assets without losing the exact configuration that produced a useful result.

## Reported components and experiments

- Local project: ~/ai-ad-brain
- CosyVoice2-0.5B text-to-speech proof of concept
- Wan2.2-S2V-14B video work, including a reported 181-frame generation
- LTX video experiments and output review
- ComfyUI/local image-video workflows
- Claude Code, OX/OpenCode, GLM-family models, and OpenRouter used for orchestration/analysis
- An echo/reverberation problem was observed in generated audio/video and remains a documented issue to reproduce and resolve

Exact versions, paths, model hashes, commands, and accepted settings have not yet been consolidated here. Treat the list as user-reported context, not a reproducible build manifest.

## Production workflow

For every meaningful creative run:

1. **Brief:** brand/client, audience, platform, objective, offer, hook, CTA, duration, aspect ratio, and prohibited claims.
2. **Inputs:** source images/video, logo version, copy, voice script, references, and usage rights.
3. **Manifest:** model, version/hash, workflow file, seed, prompt, negative prompt, resolution, frames/FPS, sampler/settings, voice model, audio settings, and agent/commit used.
4. **Output:** stable run ID and paths for draft, audio, composited video, captions, thumbnail, and final export.
5. **Review:** visual quality, anatomy/text defects, brand fidelity, hook clarity, pacing, audio quality, platform compliance, and CTA accuracy.
6. **Decision:** accepted, revise, rejected, and why.
7. **Learning:** record the smallest confirmed change that improved or degraded the result.

Do not preserve only the final MP4. Preserve enough non-secret configuration to reproduce it.

## Echo/audio issue

The accepted diagnosis is not yet recorded. Potential categories to test rather than assume include:

- Duplicate audio layers in the final composition
- Room/reverb introduced by a source/reference track
- TTS inference or post-processing settings
- Sample-rate/channel mismatch
- Time-stretched or offset duplicate tracks
- Video-pipeline audio conditioning
- Export/transcode filter chain

A valid fix requires a minimal reproducible input, isolated audio inspection before video muxing, the exact before/after configuration, and a reviewed final sample.

## Asset and data rules

- Do not commit API keys, client lead data, private voice data, or licensed source media without appropriate rights.
- Do not use fake testimonials, client results, logos, or unsupported ROI claims in generated ads.
- Record whether an asset is owned, licensed, client-supplied, generated, or temporary.
- Keep large model weights and raw generations out of the normal Git repository unless an intentional artifact-storage plan exists.
- Approved final campaign assets should be named consistently and mapped to the campaign brief in brain/MARKETING.md or an approved asset index.

## Next hardening tasks

- Inventory exact versions, paths, models, workflows, and launch commands.
- Create a run-manifest template and stable run IDs.
- Catalog the newest Dropbox/LTX/output files without copying private assets into public Git.
- Reproduce and eliminate the echo issue.
- Establish objective review checks for audio loudness, clipping, lip sync, duration, resolution, captions, and file size.
- Connect accepted outputs to Meta creative variants and tracked funnel URLs.
