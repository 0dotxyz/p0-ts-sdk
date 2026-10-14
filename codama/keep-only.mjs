import {
  deleteNodesVisitor,
  getDefinedTypeHistogramVisitor,
  rootNodeVisitor,
  visit,
} from "@codama/visitors";

/**
 * Prunes a vendor program to the instructions and accounts the SDK wraps: everything else, every
 * event and error, and then every defined type nothing kept refers to, is deleted. Add a name here
 * and regenerate when the SDK starts using more of the program.
 */
export function keepOnly({ instructions = [], accounts = [] }) {
  return rootNodeVisitor((root) => {
    const { program } = root;
    const unknown = [
      ...instructions.filter((name) => !program.instructions.some((ix) => ix.name === name)),
      ...accounts.filter((name) => !program.accounts.some((account) => account.name === name)),
    ];
    if (unknown.length > 0) {
      throw new Error(`keepOnly: ${program.name} has no ${unknown.join(", ")}`);
    }

    let pruned = visit(
      root,
      deleteNodesVisitor([
        ...program.instructions
          .filter((ix) => !instructions.includes(ix.name))
          .map((ix) => `[instructionNode]${ix.name}`),
        ...program.accounts
          .filter((account) => !accounts.includes(account.name))
          .map((account) => `[accountNode]${account.name}`),
        ...program.events.map((event) => `[eventNode]${event.name}`),
        ...program.errors.map((error) => `[errorNode]${error.name}`),
      ])
    );

    // Deleting a type can orphan the types only it referred to, so sweep until none are left
    for (;;) {
      const histogram = visit(pruned, getDefinedTypeHistogramVisitor());
      const orphans = pruned.program.definedTypes.filter(
        (type) => !histogram[`${pruned.program.name}.${type.name}`]
      );
      if (orphans.length === 0) return pruned;
      pruned = visit(
        pruned,
        deleteNodesVisitor(orphans.map((type) => `[definedTypeNode]${type.name}`))
      );
    }
  });
}
