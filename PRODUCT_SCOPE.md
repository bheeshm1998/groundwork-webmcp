# SweetSpot — product features and user experience

## 1. What SweetSpot is

SweetSpot is a shared map workspace for multi-constraint location decisions. A person can work manually or ask a WebMCP-connected agent to operate the same page. Destinations, conditions, drawings, derived regions, candidates, and activity all remain visible and editable on the map.

The agent decides which supported operations fit the request. SweetSpot performs deterministic calculations over its bundled city data. The person can inspect or correct the state instead of accepting an opaque recommendation.

## 2. The problem it solves

Location decisions rarely have one condition. Someone choosing where to live may care about travel time to two workplaces, walking access to a school and healthcare, cycling access to a park, and a personal part of the city they will consider.

General map products answer these questions separately. SweetSpot combines the supported constraints and reveals the small areas that satisfy them together, without requiring the user to operate GIS software.

## 3. Intended user and scope

The first release is for someone comparing residential areas in San Francisco or Hyderabad. It recommends candidate areas, not available homes. It does not claim current listings, price, safety, live traffic, accessibility, or opening-hours knowledge.

The same shared-workspace pattern could later support retail, office, public-service, or delivery planning, but those workflows are outside this release.

## 4. Main product features

### 4.1 Start from a real, copyable prompt

After choosing a city, the user sees three generated prompt variations. Each uses place names from that city's bundled search index and only supported modes, categories, and units. The text is selectable and copyable for use with a connected agent. It does not preload example results or mutate the workspace.

### 4.2 Add several destinations

A workspace can contain up to four named destinations. Search uses the local index first and a boundary-limited geocoder fallback when configured. Users can add or remove destinations and drag their markers. Different travel conditions may reference different destinations, while several may reference the same one.

### 4.3 Add travel-time conditions

Travel conditions answer “which areas can reach this destination within this time?” Supported modes are walking, cycling, and free-flow driving, with limits from 5 to 90 minutes. Directional street-network routing is calculated from candidate areas to the destination.

Driving is an estimate based on road class, access, one-way restrictions, and available speed tags. It does not represent live or predicted traffic.

### 4.4 Add place-access conditions

Place conditions cover groceries, schools, healthcare, parks, and cinemas by walking or cycling, with limits from 1 to 45 minutes. Grocery can mean all supported grocery records or supermarkets only. Several conditions may use the same category, mode, or destination.

Access is routed over the street network. Mapped park, school, and healthcare areas sample their perimeters so a large area is not reduced to an arbitrary center point.

### 4.5 Draw a personal preference

Some preferences are easier to draw than describe. A user can start drawing manually, or the agent can call `request_user_drawing`. In the agent flow, the tool remains in flight until the user finishes or cancels; the activity strip says plainly that the agent is waiting.

### 4.6 Combine visible conditions

With at least two visible conditions, SweetSpot intersects their valid regions inside the selected city boundary. If any hard condition cannot produce a valid layer, the combined result is empty rather than silently ignoring it.

### 4.7 Rank and explain candidate areas

SweetSpot selects separated points inside the feasible region and ranks them by their weakest normalized margin, then their average margin. Every candidate carries a metric for each active non-drawing condition. The results UI renders that generic metric list, so multi-destination and repeated-category analyses remain explainable.

The app can identify the strongest restriction, select an area, explain its margins, or remove it from the next ranking pass. These are modeled planning results, not market rankings.

### 4.8 Edit the shared workspace directly

The user can add, edit, hide, or delete conditions; add, remove, or drag destinations; draw a polygon; remove candidate areas; and use permanent Update and Reset controls on desktop or mobile. Manual changes mark derived analysis stale until Update is used. Reset requires a confirming second click and can be undone once.

### 4.9 See user and agent activity

The compact workspace strip reports the number of currently available agent actions, the latest actor and action, and any in-flight tool. The activity drawer keeps the most recent 40 entries, distinguishes user actions from agent actions, and offers one-step undo when available.

### 4.10 Share without a server

A share link carries the current canonical workspace in its URL fragment: city, destinations, conditions, drawing, removed areas, selection, and map view. Private activity and undo history are omitted. A dataset-version mismatch is rejected because calculations may have changed.

## 5. Complete user flow

1. Choose San Francisco or Hyderabad.
2. Copy one of the three city-specific starter prompts, or work entirely by hand.
3. Add one to four destinations through real location search.
4. Add any supported mix of travel and place-access conditions, including repeated categories.
5. Optionally draw a personal boundary.
6. Combine visible conditions, then rank candidate areas.
7. Inspect every candidate's actual condition metrics and strongest restriction.
8. Edit a limit, mode, category, visibility state, destination, or drawing; use Update to recalculate.
9. Review the actor-labelled activity history and undo the latest meaningful change if needed.
10. Create a share link that restores the canonical workspace.

An agent may perform the same domain operations through WebMCP. If a request contains an unsupported constraint such as live traffic, public transit, housing listings, or a distance radius, the tool guidance requires the agent to say so instead of claiming it was applied.

## 6. What the user receives

The output is a live, inspectable workspace containing:

- the selected city and up to four destinations;
- every visible and hidden condition;
- individual condition layers and their combined feasible region;
- up to three ranked candidate areas with per-condition metrics;
- the strongest computed restriction when requested;
- activity with actor and in-flight status; and
- a version-checked share link.

## 7. How the problem worked without WebMCP

A fully manual workflow requires repeated map searches and visual comparison. A general AI can describe neighborhoods but cannot reliably calculate these exact intersections from the page's current state. A computer-control agent can click the UI, but it must infer state from pixels and is fragile when controls or layout change. A separate MCP server can calculate geometry, but it creates another copy of state that the person cannot directly inspect and edit on the open page.

All of these approaches can help. Their weakness is the handoff between the user's map and the agent's model of it.

## 8. What WebMCP changes

WebMCP lets the open page expose domain operations tied to the live workspace. SweetSpot registers only actions that are currently valid. Both manual controls and tools call the same application service, so a change made by either actor is immediately visible to the other.

The page exposes 19 short, verb-first tools:

`get_workspace`, `search_locations`, `add_destination`, `remove_destination`, `add_travel_condition`, `add_place_condition`, `request_user_drawing`, `update_condition`, `delete_condition`, `set_layer_visibility`, `combine_conditions`, `recalculate`, `rank_areas`, `analyze_restriction`, `select_area`, `explain_area`, `remove_area`, `undo`, and `create_share_link`.

Tool descriptions provide enum values, units, limits, and defensive guidance. Large GeoJSON remains inside the page; tool results return compact summaries.

## 9. Before and after WebMCP

| Task | Without page-scoped tools | With SweetSpot WebMCP |
| --- | --- | --- |
| Read the current plan | Infer it from controls or duplicate state elsewhere | Call `get_workspace` |
| Search a destination | Drive an input and inspect suggestions | Call `search_locations` and ask if ambiguous |
| Change a condition | Locate and manipulate several controls | Call the corresponding domain operation |
| Know what is possible | Guess from the UI | Observe the live capability set |
| Ask for a subjective boundary | Describe coordinates or exchange files | Wait on `request_user_drawing` while the person draws |
| Continue after a manual edit | Re-read pixels and reconstruct state | Read the same canonical workspace |

## 10. Why WebMCP is central

SweetSpot does not expose a generic remote geometry library. Its tools express product concepts such as destination travel, place access, candidate ranking, and user drawing. The most important interaction is a tool call that pauses for geographic judgment from a person and resumes with the polygon they created on the shared page.

Capability registration is also workspace state: combining appears only when valid, ranking only after a feasible region exists, and candidate actions only after ranking. This makes the tool surface an accurate instruction manual for the current UI.

## 11. Trust and safety

- All bundled place records and coordinates come from recorded public sources; there is no synthetic geographic fallback.
- Every supported calculation is visible as an editable condition and map layer.
- Unsupported modes and claims are declared in tool guidance and product copy.
- A hard-condition failure cannot be hidden by quietly dropping the condition.
- User and agent actions are distinguishable, in-flight operations are visible, and the last meaningful edit can be undone.
- Share links omit private activity history and fail closed on dataset-version mismatch.

## 12. Recommended demonstration

1. Choose a city and copy a generated starter prompt; point out that the workspace is still empty.
2. Let the agent search and add two destinations from the real index.
3. Add a cycling condition to one destination and a free-flow driving condition to the other.
4. Add school and healthcare access, then add a second school condition to demonstrate repeated categories.
5. Combine and rank; open one candidate to show its generic list of travel and place metrics.
6. Ask the agent for a personal boundary. Show the visible waiting state, draw on the shared map, and resume the tool call.
7. Edit a time limit manually, use Update, and let the agent read the changed state.
8. Open the actor-labelled activity history, undo one change, and create a share link.

## 13. One-sentence definition

SweetSpot is a shared, inspectable map workspace where a person and a WebMCP agent combine supported travel, place-access, and drawn constraints to find and explain candidate areas.
