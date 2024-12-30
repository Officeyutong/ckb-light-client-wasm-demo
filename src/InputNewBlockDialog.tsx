import { useState } from "react";
import { Button, Input, Message, Modal } from "semantic-ui-react";

const InputNewBlockDialog: React.FC<{
    onClose: (newBlock?: number) => void;
    currentBlock: number;
    maxBlock: number;
}> = ({ onClose, currentBlock, maxBlock }) => {
    const [value, setValue] = useState<string>(currentBlock.toString());
    const [errorText, setErrorText] = useState<null | string>(null);
    return <Modal size="small" open>
        <Modal.Header>Input a new block height (must be in range [0, {maxBlock}])</Modal.Header>
        <Modal.Content>
            <Input fluid value={value} onChange={(e, _) => {
                setErrorText(null);
                setValue(e.target.value);
            }}></Input>
            {errorText !== null && <Message error>
                <Message.Header>Error</Message.Header>
                <Message.Content>{errorText}</Message.Content>
            </Message>}
        </Modal.Content>
        <Modal.Actions>
            <Button color="green" onClick={() => {
                const numVal = parseInt(value);
                if (numVal < 0 || numVal > maxBlock) {
                    setErrorText(`Invalid block number: ${numVal}`);
                    return;
                }
                onClose(numVal);
            }}>Confirm</Button>
            <Button color="red" onClick={() => onClose()}>Cancel</Button>
        </Modal.Actions>
    </Modal>
}

export default InputNewBlockDialog;
