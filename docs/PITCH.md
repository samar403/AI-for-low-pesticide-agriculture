# Patchwork: one-page pitch

**One line:** Drones, sensors and AI that spray only where the crop needs it.

## Problem
Weeds, insects and disease arrive in patches, but crop protection is applied uniformly because nobody can see the patches in time. Growers pay for chemical that lands on healthy plants. Resistance builds faster. Runoff reaches water and field margins. Buyers and regulators are pushing for lower use: the EU's Farm to Fork strategy, for example, targets halving pesticide use and risk by 2030.

## Solution
A closed loop: **survey → sense → decide → spray**.
1. A drone captures multispectral and thermal imagery at 10 m cells.
2. Ground sensors (traps, leaf wetness, weather, soil) supply evidence of cause that cameras miss.
3. An explainable model finds hotspots, fuses the sensor evidence, and applies agronomist rules plus legal buffers to write a per-cell prescription.
4. A spray drone flies only the rows with targets. Exports work with any variable-rate sprayer.

## Why now
- Spray drones and multispectral cameras have become everyday farm equipment, and IoT traps and weather stations are cheap.
- Edge compute is good enough to run detection at the field edge.
- Regulation and retailer residue requirements now reward measurable reductions.

## Customers
- Growers of high-value row crops (tomato, cotton, maize, soy, vegetables).
- Agronomists and crop advisers who sign off on spray decisions.
- Drone spraying contractors who want to sell precision as a service, using a white-label workspace.

## Business model (illustrative)
- Per hectare per season SaaS for growers and advisers.
- Per-hectare platform fee for contractors flying the missions.
- Later: verified reduction reports for sustainability programmes and residue compliance.

## Demo evidence (simulated)
On a 75.8 ha, four-field demo farm, about 26% of the area needed treatment on day 55, which means about 92% less product than blanket spraying for that pass and about 96% less over the season to date. The model is scored on held-out fields: about 92% accuracy and about 4% false-spray rate.

## Risks and how we handle them
- **Missed threats.** Agronomist-set thresholds, an edge buffer, and approval before every flight.
- **Generalisation from synthetic to real data.** The pipeline is modular, so the simulator can be swapped for real orthomosaics and the classifier for a segmentation CNN without changing the decision layer.
- **Regulation of aerial application.** Buffers are enforced in software, and missions are exported for operators who hold the licences.
