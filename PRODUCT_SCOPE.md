# SweetSpot — Product Features and User Experience (Hackathon Scope)

**What changed in this version:**
- The noise layer is removed. There is no easy, reliable source of street-level noise data, so it is left out instead of faked.
- Undo now works one step at a time. The user can undo only the most recent change, not any change from further back.
- Sharing a workspace no longer needs a server. The whole workspace is saved inside the link itself, so opening the link rebuilds it right away.

---

## 1. What is SweetSpot?

SweetSpot is a map-based workspace that helps a person solve location problems with an AI agent.

The user explains what they need in normal language. SweetSpot turns those needs into visible areas on a map, combines them, and shows the locations that satisfy the most important conditions.

The key idea is simple:

> The AI decides which map operations are needed, SweetSpot performs the exact geographic calculations, and the user can see and correct the result directly on the map.

SweetSpot is not another chatbot that returns a list of places. It gives the user a live map containing the reasoning behind the answer.

---

## 2. The exact problem it solves

Location decisions usually involve several conditions at the same time.

For example, a person moving to San Francisco may want a home that is:

- Less than 25 minutes from the office by bicycle.
- Less than a 10-minute walk from a proper grocery store.
- Less than an 8-minute walk from a park.
- Inside an area the person is personally willing to consider.

Normal map applications are good at answering one question at a time. They can show a route from one address to another or find grocery stores nearby. They do not make it easy to combine all the conditions and answer:

> "Which small parts of the city satisfy all of these conditions together?"

Today, the user normally has to perform many searches, remember the results, switch between tabs, and make a rough judgment by looking at the map. A professional GIS tool could perform the calculations, but an ordinary user would not know how to use it.

SweetSpot gives normal users the power of a basic geographic analysis tool without requiring them to understand GIS software.

---

## 3. Who would use it?

The main user for the first version is someone deciding where to live in a new city.

The same interaction could later help people:

- Choose where to open a shop.
- Select an office location.
- Plan a delivery area.
- Identify accessible neighbourhoods.
- Compare schools based on travel and nearby facilities.
- Plan emergency shelters or public services.

The hackathon version should focus only on the housing use case. A narrow and complete experience will be clearer than several unfinished use cases.

---

## 4. Main product features

### 4.1 Ask a location question in normal language

The user does not create filters one by one. They can describe the complete problem in a single message.

Example:

> "Find me a place to live in San Francisco. It should be under a 25-minute bike ride from 1 Market Street, within a 10-minute walk of a grocery store, and within an 8-minute walk of a park."

The AI reads the request and asks SweetSpot to create the required map layers.

### 4.2 Turn every condition into a visible map layer

Each condition appears as a different coloured area on the map.

For example:

- Cyan shows all places reachable from the office by bicycle within 25 minutes.
- Amber shows areas close enough to grocery stores.
- Green shows areas close enough to parks.

The user can switch each layer on or off. This makes the result understandable. They can see why a location qualifies instead of trusting a list produced by the AI.

Walking access to stores and parks is based on straight-line distance from each place, not real walking directions. This keeps it fast and simple, but it is an estimate rather than an exact walking time.

### 4.3 Combine several conditions

SweetSpot calculates where the allowed areas overlap and removes excluded areas.

The remaining highlighted shape is the feasible region: the parts of the city that satisfy all current conditions.

This is the core calculation that would otherwise require a person to compare several maps manually or use specialist GIS software.

### 4.4 Recommend candidate areas

SweetSpot places pins on the three strongest candidate blocks or small areas inside the feasible region.

For every candidate, the user sees:

- Bicycle time to the office.
- Walking time to the nearest suitable grocery store.
- Walking time to a park.
- Which conditions it satisfies comfortably.
- Which condition is close to failing.
- A short explanation of its main trade-off.

The first version recommends areas, not available houses. It should not pretend to know current property availability unless a reliable listing source is added later.

### 4.5 Explain what is restricting the search

Sometimes the result will be too small or completely empty. SweetSpot identifies which condition is removing the largest amount of otherwise suitable land.

For example:

> "The 25-minute bicycle limit is the strongest restriction. Increasing it to 30 minutes would expand the matching area from 0.4 km² to 1.1 km²."

This is calculated by the map software. It is not a guess made by the AI.

The user can accept the suggestion or keep the original condition.

### 4.6 Let the user draw their personal preference

Some preferences are difficult to express as text. A user may simply know that they only want to live in a particular part of the city.

The AI can ask:

> "Please draw the part of the city you would actually consider."

SweetSpot activates the drawing mode. The user draws a shape directly on the map. As soon as the drawing is finished, it becomes another condition in the analysis.

This is an important interaction because:

- The AI handles the difficult calculations.
- The human supplies personal judgment.
- Both work on the same map instead of describing shapes back and forth in words.

### 4.7 Directly edit the map

The user remains in control and can:

- Drag the office marker to a new location.
- Change a time limit.
- Edit the shape they drew.
- Remove an unwanted candidate.
- Hide or delete a condition.
- Select a candidate for a detailed explanation.

After a meaningful edit, the analysis can be recalculated using the new state.

### 4.8 Show an activity history

A side panel lists what the AI just did, in simple wording, such as:

- "Created a 25-minute bicycle area from 1 Market Street."
- "Added walking access to 12 grocery stores."
- "Combined three allowed areas."
- "Ranked three candidate blocks."

If the last change was not helpful, the user can undo it with one tap. Only the most recent change can be undone. This keeps the feature simple to build while still making the workspace safe to experiment with.

### 4.9 Show which actions are currently possible

The actions available to the AI change as the workspace changes.

For example:

- Combining layers is only possible after at least two layers exist.
- Ranking candidate areas is only possible after a feasible region exists.
- Explaining a candidate is only possible after candidates have been generated.
- Finishing a drawing is only possible while the user is drawing.

The interface can show a small label such as "6 agent actions available." This helps the user and the judges see that the webpage is lending useful abilities to the AI based on the current state.

### 4.10 Save and share the complete workspace

The user can create a link that carries the whole workspace inside it:

- The office location.
- All active conditions.
- The user-drawn area.
- The selected candidate.
- The current map view.

Nothing needs to be saved on a server. The link itself holds all the details, so opening it rebuilds the exact same workspace right away. Another person can open the link, see the same workspace, and continue the analysis with their own AI agent. No screenshot or long written explanation is required.

---

## 5. Complete user flow

### Step 1: Open SweetSpot

The user opens the website. They see:

- A large map.
- A simple prompt asking, "What location decision are you trying to make?"
- A small panel for active conditions and results.

The page can also offer a sample problem so the user immediately understands what the product does.

### Step 2: Describe the requirement

The user explains the full housing requirement in one message.

They do not need to know terms such as isochrone, polygon, layer, intersection, or GIS.

### Step 3: Confirm unclear details

If something is unclear, the AI asks one short question before changing the map.

Examples:

- "Which office address did you mean?"
- "By grocery store, do you mean a full supermarket or will a convenience store work?"

SweetSpot should not silently invent important preferences.

### Step 4: Watch the conditions appear

The map moves to the city selected on the homepage and adds each condition as a visible layer.

The user sees the result being built instead of waiting for an unexplained final answer.

### Step 5: See the matching area

SweetSpot combines the layers. A smaller highlighted area remains.

A short result might say:

> "0.4 km² satisfies all three conditions."

If there is no matching area, the product explains why and suggests one useful relaxation.

### Step 6: Review three candidate areas

Three pins appear inside the matching area. A comparison table shows their travel times, access, and trade-offs.

The user can click any pin to highlight its details.

### Step 7: Add personal judgment by drawing

The AI asks the user to draw the area they would genuinely consider.

The user draws a rough boundary. SweetSpot adds it to the analysis and updates the result.

### Step 8: Correct or change the analysis

The user can drag the office pin, edit the drawing, change a time limit, or remove a condition.

For example, they may drag the office marker to a different branch office. SweetSpot detects that the shared map state has changed, and the AI can rerun the relevant calculations.

### Step 9: Understand the trade-offs

The user asks:

> "Why is candidate two ranked below candidate one?"

The selected candidate is explained using the actual values already present in the map workspace.

### Step 10: Save or share the result

When satisfied, the user creates a link that holds the whole workspace and sends it to a partner, friend, or relocation adviser.

The receiver opens the exact same analysis and can continue changing it.

---

## 6. What the user receives at the end

The result is not only a paragraph or a list of neighbourhood names. The user receives:

- A visible feasible region.
- Three ranked candidate areas.
- Exact values for every condition.
- A clear trade-off explanation.
- A record of what the AI did to get there.
- The ability to edit and recalculate it.
- A link that preserves the workspace.

The final decision still belongs to the human. SweetSpot reduces the search space and makes the reasoning inspectable.

---

## 7. How this problem was solved before WebMCP

There were several possible approaches before WebMCP. Each could solve part of the problem, but the full human-and-agent loop was awkward.

### 7.1 Fully manual method

The user would:

1. Search for the office in a map application.
2. Test bicycle routes from several neighbourhoods, one by one.
3. Search for grocery stores near each neighbourhood.
4. Search again for parks.
5. Keep several tabs open or record the results in a spreadsheet.
6. Visually compare all the information.
7. Repeat the work whenever the office or time limit changes.

This is slow and imprecise. The user is forced to combine the results in their head.

### 7.2 Asking a normal AI with web search

An AI with web search could find neighbourhood guides, travel estimates, parks, and grocery stores. It could produce a useful written recommendation.

However, it would struggle to:

- Calculate exact travel areas over a road network.
- Combine several geographic shapes precisely.
- Know the exact shape the user drew on a webpage.
- Access temporary markers and unsaved edits on the open map.
- Show how every condition changes the final region.
- Continue from a manual map correction without the user explaining it again.

The result would usually be a text recommendation based on incomplete or approximate evidence.

### 7.3 Using a computer-control agent

An AI that controls the mouse and keyboard could open a map website, type searches, click buttons, and read what is visible.

This would be inefficient because it would have to:

- Perform many small clicks for a single intention.
- Read a map mainly as pixels.
- Click small markers and controls accurately.
- Open place cards one by one.
- Estimate boundaries from colours on the screen.
- Repeat many actions after every change.

It may also break when the page layout changes. Computer control is useful for websites that expose only a visual interface, but it is a poor way to perform exact geometric work.

### 7.4 Using a traditional MCP server

A traditional MCP server could expose useful geographic operations to an AI. For example, it could calculate routes, search for places, and intersect geographic shapes.

This approach can be fast and technically capable. WebMCP does not make those calculations possible for the first time.

The difficult part is keeping the server's state synchronized with the live webpage. The system must continuously communicate:

- What part of the map the user is viewing.
- Which layers are visible.
- Which marker the user just moved.
- The shape the user is currently drawing.
- Which candidate is selected.
- Which changes are still unsaved.

A team could build a separate backend, frontend, and MCP server to do this. But someone has to build and maintain the system that keeps them all in sync. Without that, the AI might work from old information while the person is already looking at something new.

---

## 8. What WebMCP changes

WebMCP allows SweetSpot itself to tell the AI what actions it supports on the currently open page.

The AI does not need to guess which button to click. It can ask the page to perform meaningful actions such as:

- Create a 25-minute bicycle area.
- Find areas within a 10-minute walk of groceries.
- Combine the current layers.
- Rank candidate blocks.
- Read the current workspace state.
- Ask the user to draw a shape.
- Undo the last change.

These actions use the same live state that the user is seeing. If the user moves a marker or edits a shape, the next AI action can use that updated state directly.

This creates one continuous loop:

1. The user describes the goal.
2. The AI chooses an operation.
3. The webpage performs the exact calculation.
4. The result becomes visible on the map.
5. The user corrects or adds something.
6. The AI continues using the corrected state.

The biggest benefit is not that WebMCP can calculate maps while other methods cannot. The benefit is that the agent, the map software, and the human can work on the same live geographic workspace without fragile mouse control or a separate state-synchronization system.

---

## 9. Before and after WebMCP

| Task | Before WebMCP | With SweetSpot and WebMCP |
|---|---|---|
| Express the need | Run several searches and set filters separately | Describe the complete problem in normal language |
| Calculate travel reach | Test routes from many locations or use specialist software | The agent asks the page to create an exact travel area |
| Combine conditions | Compare several maps mentally | The page combines the shapes exactly |
| Give personal geographic input | Describe an area using neighbourhood names or coordinates | Draw the preferred area directly on the map |
| Understand the result | Trust a list or inspect many tabs | See every condition and the final overlap |
| Correct the AI | Explain the correction in text and repeat the search | Move a marker or edit a shape directly |
| Continue after a correction | Rebuild context manually | The agent reads the updated live workspace |
| Share the work | Send screenshots, notes, and links | Send one link containing the complete workspace |

---

## 10. Why WebMCP is central to this product

SweetSpot would be a weak WebMCP project if it only allowed an AI to zoom the map, pan left, or click the search box. Those are button-level actions, and a computer-control agent can already perform them.

SweetSpot instead gives the AI higher-level geographic abilities. One action can create a travel area, combine several shapes, or rank candidates using the current map state.

The strongest WebMCP moment is when the AI pauses and requests geographic input from the human. The user draws a shape, and that shape becomes the result of the AI's request. This shows real cooperation:

- The AI contributes planning and reasoning.
- SweetSpot contributes precise spatial calculation.
- The human contributes taste, judgment, and correction.

None of the three is treated as a passive observer.

---

## 11. Trust and safety from the user's point of view

The user should never lose control of the workspace.

SweetSpot should therefore:

- Show every AI action in plain language.
- Let the user undo the most recent map change.
- Ask before clearing or publicly sharing a workspace.
- Distinguish calculated facts from AI-written explanations.
- Ask when an important preference is unclear.
- Never claim that a candidate area has available housing unless current listing data supports it.
- Display the data assumptions behind grocery, park, and travel results, and be clear that walking access is an estimate, not an exact walking time.

The purpose is to help the user make a better decision, not to create an answer that merely looks confident.

---

## 12. Recommended hackathon demo flow

The demo should show one complete story in about 90 seconds:

1. Choose San Francisco or Hyderabad and open a clean city map.
2. Ask the housing question in normal language.
3. Watch the bicycle, grocery, and park layers appear.
4. Show the final matching region and three ranked candidates.
5. Show the calculated message explaining the strongest restriction.
6. Ask the user to draw the part of the city they would personally consider.
7. Draw a shape and watch the results update.
8. Drag the office marker and rerun the analysis.
9. Open the activity history and undo the most recent action.
10. Create a shareable link and reopen the same workspace.

This demo proves the full product idea: natural-language intent, exact map computation, visible reasoning, human correction, and continued agent action over the same live state.

---

## 13. One-sentence product definition

> SweetSpot is a shared spatial reasoning workspace where an AI composes map operations, the webpage performs them precisely, and the human steers the answer by editing the same live map.
