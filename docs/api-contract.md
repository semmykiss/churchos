# Grace ChMS — API Contract v1

Base URL: `/api/v1`. All requests/responses JSON unless noted.
Auth: HttpOnly cookie `chms_session` (set by `POST auth/login`).
Errors: non-2xx returns `{ "error": "<code>", "message": "<human text>", "details"?: any }`.
Permission errors → 403 `{error:"forbidden"}`. Auth required unless marked **PUBLIC**.

Conventions:
- All money fields are integer cents: `amountCents`. Currency USD.
- All datetimes ISO 8601 strings.
- `person` label = `${firstName} ${lastName}`.

---

## Auth
| Method | Path | Perm | Notes |
|---|---|---|---|
| POST | `auth/login` | PUBLIC | `{email,password}` → `{user: SessionUser}`; sets cookie. 401 on bad creds. |
| POST | `auth/logout` | any authed | clears cookie → `{ok:true}` |
| GET | `auth/me` | PUBLIC | `{user: SessionUser|null}` |

`SessionUser = { sessionId, userId, membershipId, orgId, orgName, campusId, campusName, email, name, personId, roleKeys[], roleNames[], permissions[], amr }`

## People (`people.view` unless noted)
| Method | Path | Perm | Query/Body → Response |
|---|---|---|---|
| GET | `people` | people.view | q:`search,stage,status,tagId,groupId,page,pageSize` → `{total,page,pageSize,items:PersonListItem[]}` |
| GET | `people/duplicates` | people.create | q:`email,phone,firstName,lastName,birthdate` → `{exact:Dup[],fuzzy:Dup[]}` |
| POST | `people` | people.create | body CreatePerson → `{duplicates:{exact,fuzzy}|null, created:{id,name}|null}`. If duplicates and no `force:true` → returns duplicates instead of creating. If no email+phone and no `force` → 400 `{details:{needsForce:true}}` |
| GET | `people/:id` | people.view | → PersonDetail |
| PUT | `people/:id` | people.edit | body Partial<CreatePerson> → `{id}` |
| POST | `people/:id/stage` | people.edit | `{stage,note?}` → `{id,lifecycleStage}` |
| POST | `people/:id/archive` | people.archive | → `{id,archived:true,retainedRecords:{gifts,attendance}}` |
| POST | `people/merge` | people.merge | `{survivorId,mergedId,survivors:{field:"survivor"|"merged"}}` → `{survivorId,mergedId,unmergeableUntil}` |
| GET | `households` | people.view | q:`search` → `{items:HouseholdDTO[]}` |
| GET | `people/export.csv` | people.view | → text/csv (audited) |

`PersonListItem = {id,firstName,lastName,preferredName,email,phone,birthdate,gender,status,lifecycleStage,membershipStatus,allergies,firstVisitAt,lastActivityAt,household:{id,name,role}|null,tags:{id,name,color}[]}`
`CreatePerson = {firstName,lastName,preferredName?,email?,phone?,birthdate?(yyyy-mm-dd),gender?,lifecycleStage?,notes?,allergies?,householdName?,householdRole?,force?}`
`PersonDetail = {person:{...fields, custom:object}, household:{id,name,addressLine1,city,region,members:{personId,name,role,isThisPerson}[]}|null, guardians:{personId,name,phone,authorizedPickup,custodyRestricted}[], groups:{id,name,role,meetingDay,meetingTime}[], stageHistory:{stage,previousStage,changedAt,changedByName,note}[], tags:[], attendance:{id,eventName,eventStartsAt,kind,status,method,firstTime}[], giving:{visible:boolean,total:number|null,gifts:{id,amountCents,receivedOn,method,status,funds:{name,amountCents}[]}[]}, care:{visible:boolean,cases:{id,type,stage,status,urgency,confidentialityTier,summary,openedAt}[]}}`
`Dup = {id,name,email,phone,birthdate,lifecycleStage}`
`HouseholdDTO = {id,name,addressLine1,city,region,postalCode,members:{personId,name,role,email,phone}[]}`

## Groups (`groups.*`)
| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | `groups` | groups.view | q:`search,type,leaderPersonId,mine(true)` → `{items:GroupDTO[]}`. `mine` filters to groups the leader leads (or member of for ministry_leader) |
| POST | `groups` | groups.manage | body `{name,type,campusId?,leaderPersonId?,meetingDay?,meetingTime?,locationText?,capacity?,description?,isOpen?}` → GroupDTO |
| GET | `groups/:id` | groups.view | → GroupDetail: `{group:GroupDTO, members:GroupMemberDTO[], joinRequests:{id,person:{id,name},message,createdAt}[], attendanceRate, absentees:{personId,name,weeksAbsent,lastSeen}[], meetings:{id,startsAt,presentCount}[]}` |
| PUT | `groups/:id` | groups.manage | partial group → GroupDTO |
| POST | `groups/:id/members` | groups.manage | `{personId,role?}` → adds member (upsert) |
| DELETE | `groups/:id/members/:personId` | groups.manage | marks left → `{ok}` |
| POST | `groups/:id/join-requests/:requestId` | groups.manage | `{action:"approve"|"decline"}` → `{ok}` |
| POST | `groups/:id/attendance` | groups.attendance | `{eventId, records:{personId,status}[]}` (event = group meeting) → `{saved:n}`. Creates/updates attendance rows |
| POST | `groups/:id/meetings` | groups.attendance | `{date(yyyy-mm-dd)}` → materializes a group_meeting event → `{eventId}` |

`GroupDTO = {id,name,type,campusId,leaderPersonId,leaderName,meetingDay,meetingTime,locationText,capacity,description,isOpen,isConfidential,status,memberCount}`
`GroupMemberDTO = {personId,name,email,phone,role,status,joinedAt}`

## Events (`events.*`)
| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | `events` | events.view | q:`from,to,kind,search,serviceId` → `{items:EventDTO[]}` sorted by startsAt |
| POST | `events` | events.manage | `{name,kind,campusId?,startsAt,endsAt,roomText?,capacity?,checkinEnabled?}` → EventDTO |
| GET | `events/:id` | events.view | → `{event:EventDTO, attendance:{personId,name,status,checkedInAt,firstTime,isVolunteer}[], headcount, assignments:{personId,name,roleName,status}[]}` |
| POST | `events/:id/cancel` | events.manage | `{reason}` → `{ok}` (per-occurrence cancel) |
| POST | `events/:id/attendance` | groups.attendance | `{records:{personId,status}[], method:"roster"|"manual", reason?}` → `{saved:n}` (headcount/manual mode for adult services) |
| GET | `services` | events.view | → `{items:{id,name,timeOfDay,byDay,durationMinutes,checkinEnabled}[]}` |

`EventDTO = {id,name,kind,campusId,serviceId,groupId,startsAt,endsAt,roomText,capacity,checkinEnabled,status,headcount?}`

## Check-in (kiosk = device principal; staff = `checkin.*`)
| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | `checkin/rooms` | checkin.view | → `{items:{name,ageGroups[],capacity?}[]}` (static room config from org settings) |
| POST | `checkin/sessions` | checkin.manage | `{eventId}` → creates checkin session `{id,kioskToken,eventId,opensAt,closesAt,name}` |
| GET | `checkin/sessions?active=true` | checkin.view | → `{items:[...]}` for today's event |
| POST | `checkin/sessions/:id/close` | checkin.manage | → `{ok}` |
| GET | `kiosk/families` | PUBLIC + kiosk token | q:`token,<query>` — look up family by phone digits or name → `{items:{householdId,householdName,guardians:{personId,name}[],children:{personId,name,age,room,allergies,hasActiveCheckin,activeCode}[]}}` |
| POST | `kiosk/checkin` | PUBLIC + kiosk token | `{token,childIds:[personId],guardianPersonId}` → `{checkins:{personId,name,room,pickupCode,allergies,checkedInAt}[],householdName}`. Security code: 4-char, per child per occurrence, unique in room. If child already checked in → returns existing with same code |
| POST | `kiosk/checkout` | PUBLIC + kiosk token | `{token,childId,code?,guardianPersonId?}` → verifies code or authorized guardian → `{ok,child:{name,checkedOutAt}}`. Wrong code → 403 `{error:"invalid_code"}` |
| GET | `kiosk/roster` | PUBLIC + kiosk token | → `{children:{name,room,checkedInAt,code,allergies}[],byRoom:{room,children[]}[]}` |
| GET | `checkin/roster?eventId=` | checkin.view | staff room roster → `{byRoom:{room,children:{personId,name,checkedInAt,pickupCode,allergies,guardians:{name,phone,authorizedPickup}[]}[], allergyCount}[]}` |
| POST | `checkin/checkout` | checkin.view | staff override: `{childId,eventId,reason}` → `{ok}` (audited) |

## Giving (`giving.*`)
| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | `funds` | giving.view | → `{items:{id,name,code,type,isTaxDeductible,goalCents,isActive,receivedCentsYTD}[]}` |
| POST | `funds` | giving.manage | `{name,code,type?,isTaxDeductible?,goalCents?}` → FundDTO |
| GET | `donations` | giving.view | q:`search(person/email/check),fundId,method,status,from,to,batchId,page,pageSize` → `{total,items:DonationDTO[]}` |
| POST | `donations` | giving.manage | `{personId?,householdId?,amountCents,method,receivedOn,splits:{fundId,amountCents}[],checkNumber?,memo?,batchId?,isAnonymous?}` → `{id}`. Validates splits sum == amount. Status: pending if batch open, else posted |
| POST | `donations/:id/reverse` | giving.manage | `{reason}` → creates NEW reversal donation → `{reversalId}` (original immutable) |
| GET | `batches` | batches.manage | → `{items:BatchDTO[]}` (with donationCount, totalCents) |
| POST | `batches` | batches.manage | `{name,serviceDate,kind?,depositAccount?}` → BatchDTO |
| POST | `batches/:id/post` | batches.manage | `{countedByTwo,depositAccount?}` → two-person control gate: requires countedByTwo ≠ countedByOne, all donations move pending→posted → BatchDTO |
| GET | `pledges` | giving.view | q:`fundId,campaign` → `{items:{id,person:{id,name},fund:{id,name},campaign,amountCents,frequency,startsOn,endsOn,status,progressCents,progressPct}[]}` |
| POST | `pledges` | giving.manage | `{personId,fundId,campaign,amountCents,frequency,startsOn,endsOn?}` → PledgeDTO |
| GET | `recurring-gifts` | giving.view | → `{items:{id,person:{id,name},fund,amountCents,frequency,nextRunAt,status,failureCount}[]}` |
| POST | `recurring-gifts/:id/cancel` | giving.manage | → `{ok}` |
| GET | `statements` | statements.manage | q:`taxYear` → `{items:{id,personId,personName,householdName,taxYear,totalCents,status,generatedAt,sentAt}[]}` |
| POST | `statements/generate` | statements.manage | `{taxYear}` → generates per statement-unit (household) → `{created:n}`. Uses per-gift lines + required IRS language (stored text) |
| GET | `statements/:id/preview` | statements.manage | → `{html}` (rendered statement with gift lines + "no goods or services" language) |

`DonationDTO = {id,person:{id,name}|null,householdName,amountCents,currency,method,status,receivedOn,source,feeCents,netCents,checkNumber,memo,isAnonymous,batch:{id,name,status}|null,splits:{fundId,fundName,amountCents}[],reversalOfId,createdByName}`
`BatchDTO = {id,name,kind,serviceDate,status,totalCents,donationCount,pendingCount,depositAccount,countedByOne,countedByTwo,postedByName,postedAt}`

## Communications (`comms.*`)
| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | `messages` | comms.view | → `{items:MessageDTO[]}` |
| POST | `messages` | comms.send | `{channel,subject?,bodyText,bodyHtml?,fromName?,audience:{segment:{stage?[],groupIds?[],tagIds?[],consentCategory?}},scheduledAt?}` → creates + resolves recipients respecting consent (opt-in per channel+category, suppress do_not_contact/deceased) → MessageDTO. SMS cost estimate returned |
| POST | `messages/:id/send` | comms.send | sends now (simulated delivery states) → MessageDTO |
| POST | `messages/:id/cancel` | comms.send | for scheduled → `{ok}` |
| GET | `messages/:id` | comms.view | → `{message:MessageDTO, recipients:{personId,name,address,status,sentAt,error}[]}` |
| GET | `segments/preview` | comms.send | q:`stage,groupIds,tagIds` → `{count, sample:{name}[]}` |
| GET | `consent` | consent.view | q:`search` → `{items:{personId,name,email,phone,prefs:{channel,category,optedIn,source,updatedAt}[]}}` |
| POST | `consent` | consent.view | `{personId,channel,category,optedIn,source}` → updates ledger (append semantics: new state wins) → `{ok}` |

`MessageDTO = {id,channel,subject,bodyText,status,audience,scheduledAt,sentAt,recipientCount,deliveredCount,bouncedCount,failedCount,createdByName,costCents?}`
Segment: `{stage?:string[],groupIds?:string[],tagIds?:string[],consentCategory?:string}`

## Volunteer scheduling (`schedule.*`)
| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | `volunteer-roles` | schedule.view | → `{items:{id,name,team,description,requiresBackgroundCheck,minAge,clearanceRequired,isActive}[]}` |
| POST | `volunteer-roles` | schedule.assign | `{name,team?,requiresBackgroundCheck?,minAge?,clearanceRequired?}` → RoleDTO |
| GET | `plans` | schedule.view | q:`from,to` → `{items:{eventId,startsAt,positions:{roleId,roleName,person:{id,name}|null,status,callTime}[],fillRate,needsAttention}[]}` |
| POST | `assignments` | schedule.assign | `{roleId,personId,eventId,callTime?}` → AssignmentDTO (403 if person has blockout — details flag) |
| DELETE | `assignments/:id` | schedule.assign | → `{ok}` |
| POST | `assignments/:id/respond` | PUBLIC + token, or schedule.respond | `{token?,action:"accept"|"decline"}` → `{ok}` |
| POST | `assignments/:id/no-show` | schedule.assign | → `{ok}` |
| POST | `assignments/:id/swap` | schedule.respond | `{token?,withPersonId}` → creates swap request; re-validates clearance on swap-in; leader approves → `{ok}` |
| GET | `swaps` | schedule.view | → `{items:{id,assignment:{id,roleName,startsAt,person},requestedWith:{name},status}[]}` |
| POST | `swaps/:id/approve` | schedule.assign | `{action:"approve"|"reject"}` → approves; swaps person on assignment; re-validates clearance → `{ok}` |
| GET | `blockouts?personId=` | schedule.view | → `{items:{id,personId,name,startsOn,endsOn,reason}[]}` |
| POST | `blockouts` | schedule.respond | `{personId?,startsOn,endsOn,reason?}` → `{ok}` |
| GET | `volunteer-health` | schedule.view | → `{items:{personId,name,servedLast90,declined,noShows,reliability}[]}` |

`AssignmentDTO = {id,roleName,person:{id,name},eventId,eventName,startsAt,status,callTime,responseToken}`

## Pastoral care (`care.*`)
| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | `care-cases` | care.view | q:`status,stage,type,urgency,mine` → `{items:CareCaseDTO[]}`. Filtered by confidentiality tier: owner sees all; campus_admin sees staff+case_team (NOT pastors unless assigned); ministry_leader sees staff tier only. Safeguarding banner included |
| POST | `care-cases` | care.create | `{personId,type,summary?,urgency?,confidentialityTier?,dueDate?,ownerName?}` → CareCaseDTO |
| GET | `care-cases/:id` | care.view | → `{case:CareCaseDTO, notes:CareNoteDTO[], timeline}`. Reading a pastors-tier note requires owner role → viewing is audited (`care.note.read`) |
| POST | `care-cases/:id/notes` | care.view | `{body,kind?,visibility?}` → CareNoteDTO |
| POST | `care-cases/:id/close` | care.manage | `{closeReason}` → `{ok}` (never deletable) |
| GET | `prayer-requests` | care.view | → `{items:{id,person:{id,name}|null,audience,status,isAnonymous,expiresAt,createdAt,body}[]}` (audience-filtered) |
| POST | `prayer-requests` | care.view | `{personId?,body,audience,isAnonymous?}` → {ok} |
| POST | `prayer-requests/:id/approve` | care.manage | `{action:"approve"|"reject"}` → {ok} |

`CareCaseDTO = {id,person:{id,name},type,stage,ownerName,urgency,dueDate,confidentialityTier,status,closeReason,summary,openedAt,isSafeguarding,noteCount}`
`CareNoteDTO = {id,authorName,kind,body,visibility,occurredAt}`

## Workflows (`workflows.*`)
| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | `workflows` | workflows.view | → `{items:{id,name,triggerType,isActive,version,steps,stats:{fired,suppressed,lastRunAt}}[]}` |
| POST | `workflows/:id/toggle` | workflows.manage | `{isActive}` → {ok} |
| POST | `workflows/:id/test` | workflows.manage | `{personId}` → dry-run showing what would fire → `{steps:[{type,detail,suppressed?}]}` |
| GET | `workflow-runs` | workflows.view | q:`workflowId,limit` → `{items:{id,workflow:{name},subjectName,status,firedReason,detail,startedAt,finishedAt}[]}` |

## Reports (`reports.view`)
| Method | Path | Notes |
|---|---|---|
| GET | `reports/this-week` | → `{attendanceThisWeek, attendanceLastWeek, attendanceSameWeekLastYear, firstTimeGuests:[{id,name,date,followUpStatus}], followUpsPending, givingMtdCents, givingBudgetCents, givingLastMonthCents, openCareCases:[{id,person,type,urgency,dueDate}], upcomingSunday:{volunteersConfirmed,volunteersNeeded,events:[{name,startsAt}]}, newPeople30:{count,items}}` |
| GET | `reports/attendance` | q:`weeks` (default 12) → `{series:{weekStart,label,headcount,checkedIn,uniqueAdults,uniqueKids}[], byCampusByService:[{name,avgHeadcount}]}` |
| GET | `reports/giving` | q:`months` (default 12) → `{series:{month,label,totalCents,byFund:{fund,amountCents}[]}[], ytdCents, ytdLastYearCents, avgWeeklyCents, topFunds:[{fund,totalCents}], pledgeProgress:[{campaign,pledgedCents,receivedCents,pct}]}` |
| GET | `reports/groups` | → `{groups:{id,name,leader,memberCount,capacity,fillRate,avgAttendance,absenteeCount}[], leaderless:[name], joinRequestsPending:n}` |
| GET | `reports/volunteers` | → `{fillRateNext4, noShowRate90, needsByRole:[{role,confirmed,needed}], health:[{name,served90,declined,noShows,reliability}]}` |
| GET | `reports/new-people` | q:`days` (30) → `{firstTime:[{id,name,firstVisitAt,inGroup,followUpStatus}], movedStages:[{name,from,to,at}], guestsToIntegrating}` |
| GET | `reports/metric-dictionary` | → `{items:{key,name,definition,formula}[]}` (headcount, checked-in, unique attender, giving gross/net, pledge progress…) |

## Member portal (`portal.use` — any authed user w/ person record)
| Method | Path | Notes |
|---|---|---|
| GET | `portal/me` | → `{person:{id,name,email,phone,household,tags}, giving:{visible,ytdCents,recent[],recurring[]}, groups:[{id,name,role,meetingDay,meetingTime,locationText}], schedule:[{roleName,eventName,startsAt,status,callTime}], children:[{personId,name,room}], prayerRequests:[], consents:{channel,category,optedIn}[], upcomingEvents:[{name,startsAt}]}` |
| PUT | `portal/me` | `{email?,phone?}` → {ok} (own profile only) |
| POST | `portal/me/consent` | `{channel,category,optedIn}` → {ok} |
| POST | `portal/me/gift` | `{amountCents,fundId,method,frequency}` → simulated → `{ok,donationId}` (no card data — demo processor token only) |

## Admin (`admin.view` / `audit.view`)
| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | `admin/permission-matrix` | admin.view | → `{roles:{key,name,permissions[]}[], permissions:[{key,module,label}], matrix:{roleKey:[permissionKeys]}}` — "who can see giving?" screen |
| GET | `audit-log` | audit.view | q:`page,action,entityType,search` → `{total,items:{id,createdAt,actorLabel,actorType,action,entityType,before,after,ip}}` |
| GET | `admin/settings` | admin.view | → `{org:{name,timezone,currency,plan,fiscalYearStartMonth}, settings:{monthlyBudgetCents,quietHours}}` |
| PUT | `admin/settings` | owner only | body → {ok} (audited) |
| GET | `admin/imports` | admin.view | → `{items:{id,fileName,status,stats,createdByName,createdAt}}` |
| POST | `admin/imports/stage` | admin.view | `{csvText,fileName}` → parses + dedupe preview + per-row errors → `{id,stats:{rows,valid,duplicates,errors:[{row,reason}]},mapping}` |
| POST | `admin/imports/:id/commit` | admin.view | creates people (skips error rows), tags importBatchId → `{created,duplicates}` (audited) |
| POST | `admin/imports/:id/rollback` | admin.view | within 7 days: soft-deletes people created by the batch → `{rolledBack:n}` (audited) |

## Kiosk note
Kiosk endpoints are **PUBLIC but token-scoped**: `?token=<kioskToken>` from an open CheckinSession. The token acts as the device principal — it can only see families for lookup and children roster for today; it cannot browse the congregation or any admin screen.
