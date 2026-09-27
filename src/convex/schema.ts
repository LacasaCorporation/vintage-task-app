import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

// ── Settings / team roles ───────────────────────────────────────────────

/**
 * Detailed app permissions. Per section (tasks / notes / costing) each
 * action — view, create, edit, delete — can be explicitly allowed (`true`)
 * or denied (`false`). Missing keys default to allowed.
 */
export const sectionPermissionsValidator = v.object({
  view: v.optional(v.boolean()),
  create: v.optional(v.boolean()),
  edit: v.optional(v.boolean()),
  delete: v.optional(v.boolean()),
});
/** Item-level permissions: finer control inside a section. */
export const itemPermissionsValidator = v.object({
  taskLists: v.optional(sectionPermissionsValidator),
  taskFolders: v.optional(sectionPermissionsValidator),
  taskSteps: v.optional(sectionPermissionsValidator),
  notebooks: v.optional(sectionPermissionsValidator),
  notePages: v.optional(sectionPermissionsValidator),
  flagToTask: v.optional(sectionPermissionsValidator),
  materials: v.optional(sectionPermissionsValidator),
  dataImport: v.optional(sectionPermissionsValidator),
  products: v.optional(sectionPermissionsValidator),
  completedProducts: v.optional(sectionPermissionsValidator),
  projects: v.optional(sectionPermissionsValidator),
  printing: v.optional(sectionPermissionsValidator),
  purchases: v.optional(sectionPermissionsValidator),
});
export const permissionsValidator = v.object({
  tasks: v.optional(sectionPermissionsValidator),
  notes: v.optional(sectionPermissionsValidator),
  costing: v.optional(sectionPermissionsValidator),
  items: v.optional(itemPermissionsValidator),
});
export type Permissions = Infer<typeof permissionsValidator>;

/** Edge-labeled team member managed from the Settings tab. */
const teamMemberValidator = v.object({
  userId: v.id("users"),
  // "super" is reserved for the workspace owner (there can be only one).
  role: v.union(
    v.literal("super"),
    v.literal("admin"),
    v.literal("user"),
    v.literal("member"),
  ),
  // when set, the member's access comes from a manually created role
  customRoleId: v.optional(v.id("customRoles")),
  permissions: v.optional(permissionsValidator),
  /** This person's manager — another member of the same organisation. The
   *  super admin has no manager (undefined). Forms a management chain:
   *  manager → their seniors → their juniors. */
  managerId: v.optional(v.id("users")),
  invitedBy: v.optional(v.id("users")),
  joinedAt: v.number(),
});

// organisation settings singleton: one row per organisation (ownerId = super
// admin). Everything the organisation owns is scoped to this owner id.
const settings = defineTable({
  ownerId: v.id("users"), // the super admin who owns this organisation
  workspaceName: v.optional(v.string()), // organisation name
  /** Firm logo as a small data URL, shown as the app's main logo. */
  logo: v.optional(v.string()),
  /** Short code shown to users so they know where to sign in, e.g. "ORG-4F7K". */
  orgCode: v.optional(v.string()),
  orgCreatedAt: v.optional(v.number()),
  /** Default currency symbol for the workspace, e.g. "$", "€", "£", "₹". */
  currency: v.optional(v.string()),
  /** Ordered workflow statuses for Projects. Start and Finish are fixed. */
  projectStatuses: v.optional(v.array(v.string())),
  /**
   * Which accounts the automatic postings use. A bill, an invoice, a receipt
   * and a payment all read these instead of guessing from an account code, so
   * a firm that recodes or renames its chart keeps posting correctly. Anything
   * left out falls back to the standard code for that job.
   */
  accounting: v.optional(
    v.object({
      cashAccountId: v.optional(v.id("accounts")),
      bankAccountId: v.optional(v.id("accounts")),
      receivableAccountId: v.optional(v.id("accounts")),
      payableAccountId: v.optional(v.id("accounts")),
      salesAccountId: v.optional(v.id("accounts")),
      purchaseAccountId: v.optional(v.id("accounts")),
      taxAccountId: v.optional(v.id("accounts")),
      /** Rate offered on new bills and invoices, e.g. 18 for 18%. */
      taxPct: v.optional(v.number()),
    }),
  ),
  members: v.array(teamMemberValidator), // every user + role + restrictions
}).index("by_owner", ["ownerId"]);

// What one person may do with one product — the product equivalent of
// taskGrants, so a flagged product follows the same owner-first rule.
const fgGrants = defineTable({
  ownerId: v.id("users"), // firm scope — settings.ownerId
  fgId: v.id("finishedGoods"),
  userId: v.id("users"),
  canEdit: v.boolean(),
  canDelete: v.boolean(),
  canComplete: v.boolean(),
  canChangeOptions: v.boolean(),
  grantedBy: v.id("users"),
  grantedAt: v.number(),
})
  .index("by_owner", ["ownerId"])
  .index("by_fg", ["fgId"]);

// Steps (subtasks) of a product, mirroring taskSteps.
const fgSteps = defineTable({
  ownerId: v.id("users"),
  fgId: v.id("finishedGoods"),
  text: v.string(),
  isCompleted: v.optional(v.boolean()),
  order: v.optional(v.number()),
})
  .index("by_owner", ["ownerId"])
  .index("by_fg", ["fgId"]);

// Reusable groups of people inside a firm, e.g. "Site crew" or "Accounts".
// A task can be handed to a whole group in one action, and a group can pull in
// people from any branch of the hierarchy.
const userGroups = defineTable({
  ownerId: v.id("users"), // firm scope — settings.ownerId
  name: v.string(),
  description: v.optional(v.string()),
  memberIds: v.array(v.id("users")),
  createdBy: v.id("users"),
  createdAt: v.number(),
}).index("by_owner", ["ownerId"]);

// What one person may do with one task. A task's owner has every permission by
// default and hands out the rest here; with no row, the person can see the task
// but not act on it.
const taskGrants = defineTable({
  ownerId: v.id("users"), // firm scope — settings.ownerId
  taskId: v.id("tasks"),
  userId: v.id("users"),
  canEdit: v.boolean(), // title, notes, steps, files
  canDelete: v.boolean(),
  canComplete: v.boolean(),
  /** Due date, priority, repeat, tags, and handing the task on. */
  canChangeOptions: v.boolean(),
  grantedBy: v.id("users"),
  grantedAt: v.number(),
})
  .index("by_owner", ["ownerId"])
  .index("by_task", ["taskId"]);

// Sign-in credentials provisioned by the organisation's super admin. The auth
// account itself lives in the Convex Auth tables; this row is the organisation
// side of it (who created it, which org it belongs to, when it last signed in).
const credentials = defineTable({
  orgId: v.id("users"), // settings.ownerId — the organisation it belongs to
  userId: v.id("users"), // the auth user row this login signs in as
  username: v.string(), // lower-cased; unique across the deployment
  displayName: v.optional(v.string()),
  /** This person's manager — another member of the same organisation. */
  managerId: v.optional(v.id("users")),
  createdBy: v.id("users"),
  createdAt: v.number(),
  lastLoginAt: v.optional(v.number()),
  disabled: v.optional(v.boolean()),
})
  .index("by_username", ["username"])
  .index("by_org", ["orgId"])
  .index("by_user", ["userId"]);

// manually created roles (Settings → Roles)
const customRoles = defineTable({
  ownerId: v.id("users"), // workspace that defined the role
  name: v.string(),
  description: v.optional(v.string()),
  permissions: v.optional(permissionsValidator),
  createdAt: v.number(),
}).index("by_owner", ["ownerId"]);

// invites for people who haven't signed in yet; they join automatically on
// their first sign-in (matched by email)
const pendingInvites = defineTable({
  ownerId: v.id("users"), // workspace that sent the invite
  email: v.string(), // lower-cased
  role: v.union(
    v.literal("admin"),
    v.literal("user"),
    v.literal("member"),
  ),
  customRoleId: v.optional(v.id("customRoles")),
  /** Manager to attach when the invite is claimed. */
  managerId: v.optional(v.id("users")),
  createdAt: v.number(),
}).index("by_owner", ["ownerId"]);

// note page formatting: body font family
export const noteFontValidator = v.union(
  v.literal("sans"),
  v.literal("serif"),
  v.literal("mono"),
  v.literal("hand"),
);
export type NoteFont = Infer<typeof noteFontValidator>;

// note page formatting: notebook color label
export const noteColorValidator = v.union(
  v.literal("default"),
  v.literal("indigo"),
  v.literal("violet"),
  v.literal("sky"),
  v.literal("teal"),
  v.literal("emerald"),
  v.literal("amber"),
  v.literal("orange"),
  v.literal("rose"),
  v.literal("pink"),
);
export type NoteColor = Infer<typeof noteColorValidator>;

// note page formatting: ink (text) color
export const noteInkValidator = v.union(
  v.literal("default"),
  v.literal("indigo"),
  v.literal("emerald"),
  v.literal("amber"),
  v.literal("rose"),
  v.literal("sky"),
);
export type NoteInk = Infer<typeof noteInkValidator>;

// task priority rating
export const taskPriorityValidator = v.union(
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
);
export type TaskPriority = Infer<typeof taskPriorityValidator>;

// how a recurring task repeats
export const taskRecurrenceValidator = v.union(
  v.literal("daily"),
  v.literal("weekly"),
  v.literal("monthly"),
);
export type TaskRecurrence = Infer<typeof taskRecurrenceValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove
      /** Which firm this person is working in — the ownerId of a settings row.
       *  Someone can belong to several firms and picks the active one here. */
      activeFirmId: v.optional(v.id("users")),

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // the student's task ledger. one row per task entry.
    tasks: defineTable({
      ownerId: v.id("users"), // the workspace this entry belongs to
      assigneeId: v.optional(v.id("users")), // who the task belongs to
      /** When assigneeId was recorded. Rows without it predate ownership being
       *  tracked and were stamped with the *firm's* id, so their real owner is
       *  unknown and they are shown as shared instead of being misattributed. */
      assignedAt: v.optional(v.number()),
      /** Everyone the task is assigned to — a task can have several.
       *  assigneeId above stays the person who created it, i.e. the task owner
       *  who is allowed to reassign it. */
      assigneeIds: v.optional(v.array(v.id("users"))),
      /** Whole groups of people the task is assigned to (Settings → User groups). */
      groupIds: v.optional(v.array(v.id("userGroups"))),
      text: v.string(), // the task itself, e.g. "Read Ch. 4 of Biology"
      isCompleted: v.boolean(), // false until the task is checked off
      listId: v.optional(v.id("taskLists")), // which named list it belongs to
      sourcePageId: v.optional(v.id("notePages")), // set when flagged from a note
      description: v.optional(v.string()), // notes / instructions / links
      dueAt: v.optional(v.number()), // deadline timestamp (ms)
      remindAt: v.optional(v.number()), // reminder timestamp (ms)
      priority: v.optional(taskPriorityValidator), // high / medium / low
      starred: v.optional(v.boolean()), // ⭐ important flag
      tags: v.optional(v.array(v.string())), // e.g. ["work", "home"]
      recurrence: v.optional(taskRecurrenceValidator), // daily / weekly / monthly
      completedAt: v.optional(v.number()), // when it was checked off
      attachments: v.optional(v.string()), // JSON: [{id,name,type,size,data}]
    }).index("by_owner", ["ownerId"]),

    // named task lists (e.g. "Homework", "Chores")
    taskLists: defineTable({
      ownerId: v.id("users"),
      name: v.string(),
      folderId: v.optional(v.id("taskFolders")), // grouping into folders
    }).index("by_owner", ["ownerId"]),

    // subtasks (steps) that break a big task into pieces; they carry the same
    // detail fields as a task, and a subtask's due date is capped by its
    // parent task's due date on the server
    taskSteps: defineTable({
      ownerId: v.id("users"),
      taskId: v.id("tasks"),
      text: v.string(),
      isCompleted: v.boolean(),
      description: v.optional(v.string()),
      dueAt: v.optional(v.number()),
      remindAt: v.optional(v.number()),
      priority: v.optional(taskPriorityValidator),
      starred: v.optional(v.boolean()),
      tags: v.optional(v.array(v.string())),
      recurrence: v.optional(taskRecurrenceValidator),
      attachments: v.optional(v.string()),
      completedAt: v.optional(v.number()),
    })
      .index("by_task", ["taskId"])
      .index("by_owner", ["ownerId"]),

    // folders that group task lists
    taskFolders: defineTable({
      ownerId: v.id("users"),
      name: v.string(),
    }).index("by_owner", ["ownerId"]),

    // raw materials used for job/task costing (price per unit)
    rawMaterials: defineTable({
      ownerId: v.id("users"),
      code: v.optional(v.string()), // material code / SKU
      name: v.string(),
      category: v.optional(v.string()), // managed master value
      subCategory: v.optional(v.string()), // managed master value
      unit: v.string(), // managed master value, e.g. kg, m, pcs, L, hr
      pricePerUnit: v.number(),
      // how much is on hand; raised by purchase bills, lowered by usage
      stock: v.optional(v.number()),
      // what was already on hand before any bill was recorded; set from the
      // Opening balance tab and kept as the authoritative figure
      opening: v.optional(v.number()),
    }).index("by_owner", ["ownerId"]),

    // a purchase bill: buying raw materials, which adds to their stock
    purchases: defineTable({
      ownerId: v.id("users"),
      number: v.string(), // auto PUR0001, PUR0002, …
      supplier: v.optional(v.string()),
      supplierId: v.optional(v.id("vendors")),
      supplierAddress: v.optional(v.string()),
      purchasedAt: v.number(), // ms
      note: v.optional(v.string()),
      currency: v.optional(v.string()),
      discountPct: v.optional(v.number()),
      taxPct: v.optional(v.number()),
      dueAt: v.optional(v.number()),
      lines: v.array(
        v.object({
          materialId: v.id("rawMaterials"),
          name: v.string(),
          unit: v.string(),
          qty: v.number(),
          unitCost: v.number(),
        }),
      ),
      total: v.number(),
      isPaid: v.optional(v.boolean()),
      /**
       * The journal entry this bill posted. Absent means it never reached the
       * ledger — the register offers to repair it rather than hiding that.
       */
      entryId: v.optional(v.id("journalEntries")),
      /** The entry that settled this bill, when it has been paid. */
      paymentEntryId: v.optional(v.id("journalEntries")),
      /**
       * The purchase order this bill was raised from. A bill raised from an
       * order is that order's delivery, so the order is closed out with it.
       */
      lpoId: v.optional(v.id("lpos")),
    }).index("by_owner", ["ownerId"]),

    /**
     * One row per line of a purchase bill, so an edited bill can take the old
     * quantities back out of stock and put the new ones in. `purchases.lines`
     * stays as the snapshot printed on the bill.
     */
    purchaseLines: defineTable({
      ownerId: v.id("users"),
      purchaseId: v.id("purchases"),
      materialId: v.id("rawMaterials"),
      name: v.string(),
      unit: v.string(),
      qty: v.number(),
      unitCost: v.number(),
    })
      .index("by_owner", ["ownerId"])
      .index("by_purchase", ["purchaseId"]),

    /**
     * Every stock change, so income / outgoing / balance can be reported per
     * material. `qty` is always positive; `direction` says which way it moved.
     */
    stockMovements: defineTable({
      ownerId: v.id("users"),
      materialId: v.id("rawMaterials"),
      name: v.string(), // material name at the time of the movement
      unit: v.string(),
      qty: v.number(),
      direction: v.union(v.literal("in"), v.literal("out")),
      source: v.union(
        v.literal("purchase"),
        v.literal("lpo"),
        v.literal("production"),
        v.literal("production-return"),
        v.literal("adjustment"),
      ),
      ref: v.optional(v.string()), // bill number or product name
      at: v.number(), // ms
    })
      .index("by_owner", ["ownerId"])
      .index("by_material", ["materialId"]),

    /**
     * The same ledger for finished products: what production put on the shelf,
     * what invoicing took off it, and what is left. `qty` is always positive;
     * `direction` says which way it moved.
     */
    productMovements: defineTable({
      ownerId: v.id("users"),
      productId: v.id("finishedGoods"),
      name: v.string(), // product name at the time of the movement
      unit: v.string(),
      qty: v.number(),
      direction: v.union(v.literal("in"), v.literal("out")),
      source: v.union(
        v.literal("production"),
        v.literal("sale"),
        v.literal("sale-return"),
        v.literal("adjustment"),
      ),
      ref: v.optional(v.string()), // invoice number or job name
      at: v.number(), // ms
    })
      .index("by_owner", ["ownerId"])
      .index("by_product", ["productId"]),

    /**
     * A local purchase order: what was asked of a vendor, before the bill
     * arrives. Receiving one puts the quantities into stock, so an order is a
     * real commitment rather than a note.
     */
    lpos: defineTable({
      ownerId: v.id("users"),
      number: v.string(), // auto LPO0001, LPO0002, …
      vendorId: v.optional(v.id("vendors")),
      vendor: v.optional(v.string()),
      orderedAt: v.number(), // ms
      expectedAt: v.optional(v.number()), // ms
      /** draft = not sent yet, ordered = with the vendor, received = in stock */
      status: v.union(
        v.literal("draft"),
        v.literal("ordered"),
        v.literal("received"),
        v.literal("cancelled"),
      ),
      note: v.optional(v.string()),
      lines: v.array(
        v.object({
          materialId: v.id("rawMaterials"),
          name: v.string(),
          unit: v.string(),
          qty: v.number(),
          unitCost: v.number(),
        }),
      ),
      total: v.number(),
      receivedAt: v.optional(v.number()),
      /**
       * The purchase bill raised from this order. Setting it also marks the
       * order received, so the goods come into stock exactly once — through
       * either the receipt or the bill, never both.
       */
      billId: v.optional(v.id("purchases")),
    })
      .index("by_owner", ["ownerId"])
      .index("by_status", ["status"]),

    /**
     * Money spent that is not stock: transport, rent, wages, utilities. Each
     * one is written to the ledger as a balanced journal entry, so the expense
     * list and the accounts can never disagree.
     */
    expenses: defineTable({
      ownerId: v.id("users"),
      at: v.number(), // ms, when the money left
      category: v.string(), // expense account name, e.g. "Rent"
      description: v.optional(v.string()),
      amount: v.number(), // always positive
      paidFrom: v.optional(v.id("accounts")), // cash / bank account credited
      vendorId: v.optional(v.id("vendors")),
      vendor: v.optional(v.string()),
      reference: v.optional(v.string()), // receipt or voucher number
      note: v.optional(v.string()),
      /** The journal entry this expense posted, so it can be traced back. */
      entryId: v.optional(v.id("journalEntries")),
      createdAt: v.number(), // ms
    })
      .index("by_owner", ["ownerId"])
      .index("by_at", ["at"]),

    /** Suppliers / vendors that purchase bills can be raised against. */
    vendors: defineTable({
      ownerId: v.id("users"),
      name: v.string(),
      contactName: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      address: v.optional(v.string()),
      note: v.optional(v.string()),
    })
      .index("by_owner", ["ownerId"])
      .index("by_name", ["name"]),

    /** Customers that projects can be billed to. */
    customers: defineTable({
      ownerId: v.id("users"),
      name: v.string(),
      contactName: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      address: v.optional(v.string()),
      note: v.optional(v.string()),
    })
      .index("by_owner", ["ownerId"])
      .index("by_name", ["name"]),

    /**
     * A quotation sent to a customer: what was offered, at what price. It is a
     * quote, not money in — turning one into a sales bill copies its lines.
     */
    quotations: defineTable({
      ownerId: v.id("users"),
      number: v.string(), // auto QT0001, QT0002, …
      customerId: v.optional(v.id("customers")),
      customerName: v.optional(v.string()),
      customerAddress: v.optional(v.string()),
      quotedAt: v.number(), // ms
      validUntil: v.optional(v.number()),
      note: v.optional(v.string()),
      currency: v.optional(v.string()),
      discountPct: v.optional(v.number()),
      taxPct: v.optional(v.number()),
      lines: v.array(
        v.object({
          productId: v.id("finishedGoods"),
          name: v.string(),
          unit: v.optional(v.string()),
          qty: v.number(),
          unitPrice: v.number(),
        }),
      ),
      total: v.number(),
      status: v.optional(
        v.union(
          v.literal("draft"),
          v.literal("sent"),
          v.literal("accepted"),
          v.literal("rejected"),
        ),
      ),
      /** Set once this quote has been turned into a sales bill. */
      invoicedAs: v.optional(v.id("sales")),
      invoicedAt: v.optional(v.number()),
    })
      .index("by_owner", ["ownerId"])
      .index("by_customer", ["customerId"]),

    /** A sales bill: what the customer was actually invoiced for. */
    sales: defineTable({
      ownerId: v.id("users"),
      number: v.string(), // auto SAL0001, SAL0002, …
      customerId: v.optional(v.id("customers")),
      customerName: v.optional(v.string()),
      customerAddress: v.optional(v.string()),
      soldAt: v.number(), // ms
      dueAt: v.optional(v.number()),
      note: v.optional(v.string()),
      currency: v.optional(v.string()),
      discountPct: v.optional(v.number()),
      taxPct: v.optional(v.number()),
      lines: v.array(
        v.object({
          productId: v.id("finishedGoods"),
          name: v.string(),
          unit: v.optional(v.string()),
          qty: v.number(),
          unitPrice: v.number(),
        }),
      ),
      total: v.number(),
      isPaid: v.optional(v.boolean()),
      paidAt: v.optional(v.number()),
      /** The journal entry this invoice posted. */
      entryId: v.optional(v.id("journalEntries")),
      /** The entry that settled this invoice, when the customer has paid. */
      paymentEntryId: v.optional(v.id("journalEntries")),
      /** The quote this bill came from, when it was converted from one. */
      quotationId: v.optional(v.id("quotations")),
    })
      .index("by_owner", ["ownerId"])
      .index("by_customer", ["customerId"]),

    // a costing sheet for a job / project / task
    costingSheets: defineTable({
      ownerId: v.id("users"),
      name: v.string(),
      currency: v.optional(v.string()), // display currency symbol
      markupPct: v.optional(v.number()), // profit % applied on cost
    }).index("by_owner", ["ownerId"]),

    // finished goods (FG) — the product being costed, grouped by project
    finishedGoods: defineTable({
      ownerId: v.id("users"),
      projectName: v.optional(v.string()), // group label; undefined = standalone product
      projectCode: v.optional(v.string()), // auto code for the project, e.g. PR0001
      jobId: v.optional(v.id("projectJobs")), // legacy single-job link (deprecated)
      // jobs this product is attached to — a product can serve several jobs
      // at once; undefined/empty = standalone product (no project, no job)
      jobIds: v.optional(v.array(v.id("projectJobs"))),
      name: v.string(), // FG product name, e.g. "Wooden chair"
      code: v.optional(v.string()), // product code / SKU, auto e.g. FG0001
      /**
       * A product is a stocked entity, independent of any job or project —
       * these are its ledger, exactly as `rawMaterials.stock` is for material.
       */
      /** Finished units on hand, ready to sell. */
      stock: v.optional(v.number()),
      /**
       * Units already on hand before any production or invoice was recorded —
       * set from the Opening balance tab and kept as the authoritative figure.
       */
      opening: v.optional(v.number()),
      /** Units part-made right now: a run has started but not finished. */
      inProduction: v.optional(v.number()),
      /** Units in the run currently in progress; cleared when it ends. */
      productionQty: v.optional(v.number()),
      /** Default batch qty offered when attaching this product to a job. */
      qty: v.optional(v.number()),
      unit: v.optional(v.string()), // sold per: pcs, box, set…
      category: v.optional(v.string()), // managed master value
      subCategory: v.optional(v.string()), // managed master value
      note: v.optional(v.string()), // short product description
      imageUrl: v.optional(v.string()), // data URL of the product photo
      imageAlt: v.optional(v.string()), // original file name
      currency: v.optional(v.string()),
      markupPct: v.optional(v.number()),
      // flagged products surface as a subtask under their job
      isFlagged: v.optional(v.boolean()),
      // a flagged product can be checked off in the todo list
      isCompleted: v.optional(v.boolean()),
      /** Ordered custom Projects status; Start and Finish are fixed. */
      projectStatus: v.optional(v.string()),
      // timestamp when the product was added to the flagged todo list
      flaggedAt: v.optional(v.number()),
      // its own due date & priority on the flagged board (defaults copied
      // from the parent job when the product is flagged)
      dueAt: v.optional(v.number()),
      priority: v.optional(taskPriorityValidator),
      completedAt: v.optional(v.number()),
      /** Who created it, i.e. the product's owner — allowed to reassign it. */
      assigneeId: v.optional(v.id("users")),
      /** When assigneeId was recorded; unset means the author is unknown. */
      assignedAt: v.optional(v.number()),
      /** Everyone the product is assigned to, plus whole user groups. */
      assigneeIds: v.optional(v.array(v.id("users"))),
      groupIds: v.optional(v.array(v.id("userGroups"))),
      /** Same extras a normal task has: tags, a reminder, a star, steps. */
      tags: v.optional(v.array(v.string())),
      remindAt: v.optional(v.number()),
      starred: v.optional(v.boolean()),
      // production run: set when the product is started, cleared when stopped.
      // The consumed list is what lets a stop put the stock back.
      productionStartedAt: v.optional(v.number()),
      productionConsumed: v.optional(
        v.array(
          v.object({
            materialId: v.id("rawMaterials"),
            qty: v.number(),
          }),
        ),
      ),
    }).index("by_owner", ["ownerId"]),

    /**
     * How many of a product one job needs. The batch is asked for at the
     * moment the link is made, so a product attached to two jobs can carry a
     * different quantity against each.
     */
    jobProducts: defineTable({
      ownerId: v.id("users"),
      jobId: v.id("projectJobs"),
      fgId: v.id("finishedGoods"),
      qty: v.number(), // the batch this job needs
      createdAt: v.number(),
    })
      .index("by_owner", ["ownerId"])
      .index("by_job", ["jobId"])
      .index("by_fg", ["fgId"]),

    // jobs (also called tasks) that live under a project; FG products
    // belong to a job, so the real hierarchy is Project → Job → Product
    projectJobs: defineTable({
      ownerId: v.id("users"),
      projectId: v.id("projects"), // the project this job belongs to
      name: v.string(),
      code: v.optional(v.string()), // auto code, e.g. JB0001
      description: v.optional(v.string()),
      assignee: v.optional(v.string()), // person responsible
      dueAt: v.optional(v.number()), // deadline timestamp (ms)
      status: v.optional(
        v.union(
          v.literal("planning"),
          v.literal("in_progress"),
          v.literal("paused"),
          v.literal("completed"),
          v.literal("cancelled"),
        ),
      ),
      priority: v.optional(taskPriorityValidator),
      // snapshot of the job's due date/priority at flag time — products
      // inherit these so their board cards and details start in sync
      fgDueAt: v.optional(v.number()),
      fgPriority: v.optional(taskPriorityValidator),
      startedAt: v.optional(v.number()), // when work first started
      pausedAt: v.optional(v.number()), // when it was last paused
      completedAt: v.optional(v.number()), // when it was completed
      // a flagged job shows all of its products as subtasks
      isFlagged: v.optional(v.boolean()),
      // timestamp when the job was added to the flagged todo list
      flaggedAt: v.optional(v.number()),
      /** Ordered custom Projects status; Start and Finish are fixed. */
      projectStatus: v.optional(v.string()),
    })
      .index("by_owner", ["ownerId"])
      .index("by_project", ["projectId"]),

    // projects — full project information the FG products belong to
    projects: defineTable({
      ownerId: v.id("users"),
      name: v.string(),
      code: v.optional(v.string()), // auto code, e.g. PR0001
      description: v.optional(v.string()),
      client: v.optional(v.string()), // customer / stakeholder
      assignee: v.optional(v.string()), // person responsible
      dueAt: v.optional(v.number()), // deadline timestamp (ms)
      status: v.optional(
        v.union(
          v.literal("planning"),
          v.literal("in_progress"),
          v.literal("on_hold"),
          v.literal("completed"),
          v.literal("cancelled"),
        ),
      ),
      priority: v.optional(taskPriorityValidator),
      budget: v.optional(v.number()), // planned budget
      /** Ordered custom Projects status; Start and Finish are fixed. */
      projectStatus: v.optional(v.string()),
      // flagged projects surface in the Productions view; a project is flagged
      // because something under it is flagged, not on its own
      isFlagged: v.optional(v.boolean()),
      // timestamp when the project was added to the flagged todo list
      flaggedAt: v.optional(v.number()),
    }).index("by_owner", ["ownerId"]),

    // one line inside a costing sheet
    costingItems: defineTable({
      ownerId: v.id("users"),
      sheetId: v.optional(v.id("costingSheets")), // legacy sheets
      fgId: v.optional(v.id("finishedGoods")), // lines of an FG product
      materialId: v.optional(v.id("rawMaterials")), // set for raw-material lines
      label: v.string(), // material name or custom line label
      qty: v.number(),
      unitPrice: v.number(), // copied from material but editable
      unit: v.optional(v.string()),
    })
      .index("by_sheet", ["sheetId"])
      .index("by_fg", ["fgId"])
      .index("by_owner", ["ownerId"]),

    // managed units of measure for costing (kg, pcs, m…)
    costUnits: defineTable({
      ownerId: v.id("users"),
      name: v.string(),
    }).index("by_owner", ["ownerId"]),

    // managed categories (parentId undefined) and sub-categories
    costCategories: defineTable({
      ownerId: v.id("users"),
      name: v.string(),
      parentId: v.optional(v.id("costCategories")), // set for sub-categories
    }).index("by_owner", ["ownerId"]),

    /**
     * One row of the chart of accounts — the names every journal line posts
     * against. `isGroup` rows are headings only: they hold no balance and
     * cannot be posted to.
     */
    accounts: defineTable({
      ownerId: v.id("users"),
      code: v.string(), // 1000, 1100, 4000 …
      name: v.string(),
      type: v.union(
        v.literal("asset"),
        v.literal("liability"),
        v.literal("equity"),
        v.literal("income"),
        v.literal("expense"),
      ),
      isGroup: v.optional(v.boolean()),
      note: v.optional(v.string()),
    })
      .index("by_owner", ["ownerId"])
      .index("by_code", ["ownerId", "code"]),

    /**
     * A journal entry — the header of a double-entry posting. `kind` records
     * how it was raised so the cash book and the receipts list can filter on
     * it without inspecting the lines.
     */
    journalEntries: defineTable({
      ownerId: v.id("users"),
      number: v.string(), // JE0001, JE0002, …
      at: v.number(), // the entry date, ms
      kind: v.union(
        v.literal("journal"),
        v.literal("opening"),
        v.literal("receipt"),
        v.literal("payment"),
        // posted automatically by the Expenses register, so the two can never
        // drift apart
        v.literal("expense"),
      ),
      memo: v.optional(v.string()),
      /** Customer or supplier the receipt / payment came from or went to. */
      party: v.optional(v.string()),
      /** Set when this entry was raised by an expense, so the two link up. */
      expenseId: v.optional(v.id("expenses")),
      createdAt: v.number(),
    })
      .index("by_owner", ["ownerId"])
      .index("by_at", ["ownerId", "at"]),

    /** One debit or one credit inside a journal entry. */
    journalLines: defineTable({
      ownerId: v.id("users"),
      entryId: v.id("journalEntries"),
      accountId: v.id("accounts"),
      accountCode: v.string(),
      accountName: v.string(),
      debit: v.number(),
      credit: v.number(),
      memo: v.optional(v.string()),
    })
      .index("by_entry", ["entryId"])
      .index("by_account", ["ownerId", "accountId"])
      .index("by_owner", ["ownerId"]),

    // notebooks: the top level of the notes workspace (OneNote-style)
    notebooks: defineTable({
      ownerId: v.id("users"),
      createdBy: v.optional(v.id("users")), // who created it (workspace-wide rows stay shared)
      title: v.string(),
      color: v.optional(noteColorValidator), // accent color for the notebook
    }).index("by_owner", ["ownerId"]),

    // pages inside a notebook; rendered like sheets of paper
    notePages: defineTable({
      ownerId: v.id("users"),
      createdBy: v.optional(v.id("users")), // who created it (workspace-wide rows stay shared)
      notebookId: v.id("notebooks"),
      title: v.string(),
      body: v.string(),
      parentId: v.optional(v.id("notePages")), // set when this is a sub-page
      drawing: v.optional(v.string()), // ink strokes as JSON (normalized coords)
      images: v.optional(v.string()), // placed images as JSON (src, pos, crop)
      numbered: v.optional(v.boolean()), // number each line of the body
      font: v.optional(noteFontValidator), // body font family
      color: v.optional(noteColorValidator), // notebook color label
      inkColor: v.optional(noteInkValidator), // text (ink) color
      order: v.optional(v.number()), // manual page order within the notebook
    })
      .index("by_owner", ["ownerId"])
      .index("by_notebook", ["notebookId"]),

    // add other tables here

    settings,
    userGroups,
    taskGrants,
    fgGrants,
    fgSteps,
    credentials,
    customRoles,
    pendingInvites,
  },
  {
    schemaValidation: false,
  },
);

export default schema;
