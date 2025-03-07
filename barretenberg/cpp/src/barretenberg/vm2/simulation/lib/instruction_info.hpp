#pragma once

#include <cstdint>
#include <memory>

#include "barretenberg/vm2/common/instruction_spec.hpp"
#include "barretenberg/vm2/common/opcodes.hpp"

namespace bb::avm2::simulation {

class InstructionInfoDBInterface {
  public:
    virtual ~InstructionInfoDBInterface() = default;

    virtual const ExecInstructionSpec& get(ExecutionOpCode opcode) const = 0;
    virtual ExecutionOpCode map_wire_opcode_to_execution_opcode(WireOpCode opcode) const = 0;
};

class InstructionInfoDB : public InstructionInfoDBInterface {
  public:
    const ExecInstructionSpec& get(ExecutionOpCode opcode) const override
    {
        auto it = EXEC_INSTRUCTION_SPEC.find(opcode);
        if (it == EXEC_INSTRUCTION_SPEC.end()) {
            throw std::runtime_error("Cannot find instruction spec for opcode: " +
                                     std::to_string(static_cast<int>(opcode)));
        }
        return it->second;
    }
    ExecutionOpCode map_wire_opcode_to_execution_opcode(WireOpCode opcode) const override
    {
        auto it = WIRE_INSTRUCTION_SPEC.find(opcode);
        if (it == WIRE_INSTRUCTION_SPEC.end()) {
            throw std::runtime_error("Cannot map wire opcode to execution opcode: " +
                                     std::to_string(static_cast<int>(opcode)));
        }
        return it->second.exec_opcode;
    }
};

} // namespace bb::avm2::simulation