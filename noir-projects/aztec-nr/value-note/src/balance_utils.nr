use crate::value_note::ValueNote;
use dep::aztec::{
    context::UtilityContext, note::note_viewer_options::NoteViewerOptions, state_vars::PrivateSet,
};

pub unconstrained fn get_balance(set: PrivateSet<ValueNote, UtilityContext>) -> Field {
    get_balance_with_offset(set, 0)
}

pub unconstrained fn get_balance_with_offset(
    set: PrivateSet<ValueNote, UtilityContext>,
    offset: u32,
) -> Field {
    let mut balance = 0;
    // docs:start:view_notes
    let mut options = NoteViewerOptions::new();
    let notes = set.view_notes(options.set_offset(offset));
    // docs:end:view_notes
    for i in 0..options.limit {
        if i < notes.len() {
            balance += notes.get_unchecked(i).value();
        }
    }

    if (notes.len() == options.limit) {
        balance += get_balance_with_offset(set, offset + options.limit);
    }

    balance
}
