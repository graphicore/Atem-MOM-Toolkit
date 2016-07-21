define([
    'Atem-Errors/errors'
  // needed for _cpsUIInitDrag
  , 'Atem-Property-Language/parsing/ASTOperation'
  , 'Atem-Property-Language/parsing/ASTGrouping'
  , 'Atem-Property-Language/parsing/_VoidToken'
  , 'Atem-Property-Language/flavours/MOM/Expression'
  , 'Atem-MOM/cpsTools'
  , 'Atem-Property-Language/UI'
  , 'Atem-Math-Tools/Vector'

], function(
    errors
  , ASTOperation
  , ASTGrouping
  , _VoidToken
  , Expression
  , cpsTools
  , UI
  , Vector
) {
    "use strict";
    /* jshint esnext:true */


    var svgns = 'http://www.w3.org/2000/svg';

    function attachCircle(element, vector, r) {
        var child = element.ownerDocument.createElementNS(svgns, 'circle');
        child.setAttribute('cx', vector[0]);
        child.setAttribute('cy', vector[1]);
        child.setAttribute('r', r);
        element.appendChild(child);
    }

    //////////
    //CPS*UI//
    //////////
    function uiVectorFilter(item) {
        return item && (item instanceof UI) && (item.value instanceof Vector);
    }

    function* cpsuiPropertiesGenerator(styleDict, filter) {
        var keys = styleDict.keys
          , key, i, l, item
          ;
        for(i=0,l=keys.length;i<l;i++) {
            key = keys[i];
            item = styleDict.get(key, null);
            if(!filter(item))
                continue;
            yield key;
        }
    }

    //////
    // tools for _cpsUIInitDrag
    //////
    function replaceItemInAST(item, oldItem, newItem) {
        if(item === oldItem)
            return newItem;
        if(item instanceof ASTGrouping)
            return  replaceItemInASTGrouping(item, oldItem, newItem);
        if(item instanceof ASTOperation)
            return replaceItemInASTOperation(item, oldItem, newItem);
        // not changed
        return item;
    }

    function replaceItemInASTGrouping(grouping, oldItem, newItem) {
        // keep branches unchanged that are not changed by inserting newOperation
        var result
          , oldNodes = grouping.nodes
          , i, l, item
          , newNodes = []
          , changed = false
          ;
        for(i=0,l=oldNodes.length;i<l;i++) {
            item = oldNodes[i];
            result = replaceItemInAST(item, oldItem, newItem);
            newNodes.push(result);
            if(result !== item)
                changed = true;
        }
        return (changed
                    ? new ASTGrouping(grouping.groupingToken, newNodes)
                    : grouping);
    }

    function replaceItemInASTOperation(operation, oldItem, newItem) {
        // keep branches unchanged that are not changed by inserting newOperation
        var result
          , key, oldArgs, newArgs, i, l, item
          , allNewArgs = {
                postArguments: []
              , preArguments: []
            }
          , changed = false
          ;
        for(key in allNewArgs) {
            oldArgs = operation[key];
            newArgs = allNewArgs[key];
            for(i=0,l=oldArgs.length;i<l;i++) {
                item = oldArgs[i];
                result = replaceItemInAST(item, oldItem, newItem);
                newArgs.push(result);
                if(result !== item)
                    changed = true;
            }
        }
        return (changed
                    ? new ASTOperation(operation.operator
                                     , allNewArgs.preArguments
                                     , allNewArgs.postArguments)
                    : operation);
    }

    function replaceProperty(propertyDict, oldProperty, newProperty) {
        var propertyIndexes = propertyDict.find(oldProperty.name)
          , i, l, index
          ;
        for(i=0,l=propertyIndexes.length;i<l;i++) {
            index = propertyIndexes[i];
            // found
            if(propertyDict.getItem(index) === oldProperty) {
                propertyDict.splice(index, 1, newProperty);
                return true;
            }
        }
        // not found
        return false;
    }

    /**
     *  Return the first none-_VoidToken in args or null;
     */
    function getFirstArg(args) {
        var i,l;
        for(i=0,l=args.length;i<l;i++) {
            if(args[i] instanceof _VoidToken)
                continue;
            return args[i];
        }
        return null;
    }

    function _createSVGPoint(svgElement, x, y) {
        var viewportElement = svgElement.viewportElement === null
                // this is the viewportElement
                ? svgElement
                : svgElement.viewportElement
          , svgPoint = viewportElement.createSVGPoint()
          ;
        if(x) svgPoint.x = x;
        if(y) svgPoint.y = y;
        return svgPoint;
    }

    function toSVGElementCoordinate(svgElement, x, y) {
        var svgPoint = _createSVGPoint(svgElement, x, y)
          , ctm = svgElement.getScreenCTM().inverse()
          ;
        svgPoint.x = x;
        svgPoint.y = y;
        svgPoint = svgPoint.matrixTransform(ctm);
        return new Vector(svgPoint.x, svgPoint.y);
    }

    function getSVGScreenOrigin(svgElement) {
        var svgPoint = _createSVGPoint(svgElement)
          , ctm = svgElement.getScreenCTM()
          ;
        svgPoint = svgPoint.matrixTransform(ctm);
        return new Vector(svgPoint.x, svgPoint.y);
    }

    function dragUpdate(e) {
        /* jshint validthis:true */
        var newIntrinsic
          , ast = this.property.value.value.ast
          , newAST , newOperation , newProperty, oldProperty
          // like: "(Vector 10 100)"
          // The parenthesis are intentional, so we don't have to know about
          // the nature of the other args;
          , newArgumentFormula, newArgument
          , firstArg
          , delta, initialPos, currentPos
          ;
        currentPos = new Vector(e.clientX, e.clientY)['-'](this.initialOffset);

        currentPos = toSVGElementCoordinate(this.svgElement, currentPos.x, currentPos.y);
        initialPos = toSVGElementCoordinate(this.svgElement, this.initialPos.x, this.initialPos.y);
        delta = currentPos['-'](initialPos);
        if(delta.x === 0 && delta.y === 0)
            return;
        // assert newArgument instanceof ASTGrouping
        // assert newArgument.groupingToken.literal === '('
        firstArg = getFirstArg(this.astOperation.postArguments);
        if(!firstArg)
            // this means there was no none-_VoidToken in postArguments
            throw new Error('A UI item must have at least one argument!');

        newIntrinsic = this.intrinsic['+'](delta);
        newArgumentFormula = ['(Vector ', newIntrinsic.x ,' ', newIntrinsic.y, ')'].join('');
        newArgument = Expression.factory(newArgumentFormula)[1].ast.nodes[0];

        // <==specific | generic==>

        newOperation = replaceItemInAST(this.astOperation, firstArg, newArgument);
        if(newOperation === this.astOperation) {
            // because then we are unable to create a change here, for any reason
            // maybe the property was rewritten by another routine.
            // That means the update process lost its mandate.
            console.warn('newOperation === this.astOperation', newOperation);
            this.stop();
            return;
        }

        newAST = replaceItemInAST(ast, this.astOperation, newOperation);
        if(newAST === ast) {
            // because then we are unable to create a change here, for any reason
            // maybe the property was rewritten by another routine.
            // That means the update process lost its mandate.
            console.warn('newAST === ast', newAST);
            this.stop();
            return;
        }

        newProperty = cpsTools.makeProperty(this.property.name, new Expression(newAST));
        // remember this.property because we want to update it before
        // the call to replaceProperty.
        oldProperty = this.property;
        this.property = newProperty;
        this.astOperation = newOperation;

        // finally, bring the update to the model
        if(!replaceProperty(this.rule.properties, oldProperty, newProperty)) {
            // because then we are unable to create a change here, for any reason
            // maybe the property was rewritten by another routine.
            // That means the update process lost its mandate.
            console.warn('!replaceProperty');
            this.stop();
            return;
        }
    }

    function dragStop(doc, e) {
        /* jshint validthis:true, unused:vars */
        doc.removeEventListener('mousemove', this.update, false);
        doc.removeEventListener('mouseup', this.stop, false);
    }

    function dragInit(hostElement, subscription, initalEvent) {
        var elem = initalEvent.target
          , index, item, doc, state, initialOffset
          ;
        while(true) {
            if(elem === hostElement.parentElement || !elem)
                return;
            if(elem.hasAttribute('data-cps-ui-index'))
                // found!
                break;
            elem = elem.parentElement;
        }
        index = elem.getAttribute('data-cps-ui-index');
        item = subscription.interfaces[index];
        doc = elem.ownerDocument;


        // The idea is that the update process can run as long as
        // the info in state is suficient to find the right place for an
        // update.
        // That way, also, we should be sufficiently decoupled from the display
        // updates, that will happen

        // remove the the part that is offset from element to screen origin
        // because the position of the element may change during the action.
        // e.g. when in a row of simultaneously interpolated glyphs the
        // width changes, all but the first glyph change their positions.
        // If the control used has it's origin in one of the changed
        // glyphs, our initialPos is compromised.
        initialOffset = getSVGScreenOrigin(elem);
        state = {
            initialOffset: initialOffset
          , initialPos: new Vector(initalEvent.clientX, initalEvent.clientY)['-'](initialOffset)
          , svgElement: elem
          , intrinsic: item.uiItem.value
          , rule: item.uiItem.rule
          // methods
          , update: null
          , stop: null
          // these are going to be changed on update:
          , property: item.uiItem.property
          , astOperation: item.uiItem.astOperation
        };

        state.update = dragUpdate.bind(state);
        state.stop = dragStop.bind(state, doc);

        doc.addEventListener('mousemove', state.update, false);
        doc.addEventListener('mouseup', state.stop, false);
    }

    function updateCPSUIProperty(item, propertyName) {
        var styleDict = item.mom.getComputedStyle()
          , uiItem = styleDict.get(propertyName, null)
          ;
        if(!uiVectorFilter(uiItem)) {
            // remove
            return false;
        }
        // update
        item.uiItem = uiItem;
        drawCPSUIVector(item);
        return true;
    }

    function checkAndAddUIVectors(subscription, mom, keys) {
        var i, l, propertyName, uiItem
          , styleDict = mom.getComputedStyle()
          , properties = subscription.elements.get(mom).properties
          ;
        for(i=0,l=keys.length;i<l;i++) {
            propertyName = keys[i];
            if(properties.has(propertyName))
                continue;
            uiItem = styleDict.get(propertyName, null);
            if(!uiVectorFilter(uiItem))
                continue;
            // this is an uncharted UI-vector
            addUIVector(subscription, mom, propertyName);
        }
    }

    function updateMOM(data, channelKey, eventData) {
        var subscription = data[0]
           , mom = data[1]
           , properties, seen
           , i, l, keys, propertyName, item
           , styleDict
           ;

        // process change;
        properties = subscription.elements.get(mom).properties;
        seen = new Set();
        keys = eventData;
        for(i=0,l=keys.length;i<l;i++) {
            propertyName = keys[i];
            if(seen.has(propertyName)
                    // properties wouldn't have this if it was not added
                    // yet. We want to have this checked again below
                    // at detect additions.
                    || !properties.has(propertyName))
                continue;
            seen.add(propertyName);

            item = properties.get(propertyName);
            if(!updateCPSUIProperty(item, propertyName)) {
                // item is no longer a valid ui-item
                item.dom.parentElement.removeChild(item.dom);
                subscription.interfaces[item.dom.getAttribute('data-cps-ui-index')] = null;
                properties.delete(propertyName);
            }
        }

        // detect additions
        styleDict = mom.getComputedStyle();
        keys = styleDict.keys.filter(function(key) {
                // if we have seen it when updating, we're not interested
                // if it is already in properties this is not an addition
                return !(seen.has(key) || properties.has(key));
        });
        checkAndAddUIVectors(subscription, mom, keys);
    }

    function drawCPSUIVector(item) {
        var uiItem = item.uiItem
          , value = uiItem.value
          ;
        while(item.dom.lastChild)
            item.dom.removeChild(item.dom.lastChild);

        if(uiItem.arguments[1] instanceof Vector)
            value = value['+'](uiItem.arguments[1]);
        attachCircle(item.dom, value, 10);
    }

    function addUIVector(subscription, mom, propertyName) {
        var layer = subscription.layer
          , interfaces = subscription.interfaces
          , styleDict = mom.getComputedStyle()
          , uiItem = styleDict.get(propertyName)
          , dom = layer.ownerDocument.createElementNS(svgns, 'g')
          , properties = subscription.elements.get(mom).properties
          , item = {
                    mom: mom
                  , dom: dom
                  , uiItem: uiItem
                }
          ;
        properties.set(propertyName, item);
        // init display
        drawCPSUIVector(item);

        // styling
        // TODO: cps-ui-type will have to be determined by the actual data type
        dom.classList.add('cpsui', 'type-' + mom.type, 'cps-ui-type-vector');

        // to detect when the item is used
        dom.setAttribute('data-cps-ui-index', interfaces.length);
        layer.appendChild(dom);
        interfaces.push(item);
    }

    function init(layer, momGlyph) {
        var interfaces = []
          , elements = new Map()
          , subscription = {
                layer: layer
              , elements: elements
              , interfaces: interfaces
              , elementMousedown: null
            }
          , stack = [momGlyph]
          , child, styleDict, gen, generatorItem
          , properties
          ;

        while( (child = stack.pop()) ) {
            styleDict = child.getComputedStyle();
            // assert(!elements.has(child));
            properties = new Map();
            elements.set(child, {
                  properties: properties
                , subscriptionID: styleDict.on(['add', 'change'], updateMOM, [subscription, child])
            });

            gen = cpsuiPropertiesGenerator(styleDict, uiVectorFilter);
            while(!(generatorItem = gen.next()).done)
                addUIVector(subscription, child, generatorItem.value);
            // recursion
            Array.prototype.push.apply(stack, child.children.reverse());
        }
        return subscription;
    }

    function create (glyphInterface) {

        // Eventually this could be in another display set than
        // "default" (maybe "edit" or "cps-ui"), then the different
        // controls would not cover each other and a nice separation
        // between the different concepts would be there.
        // such display sets could also be provided via plugins.
        // If someone wants to reinvent the whole glyph interaction
        // that could be the way.
        var layerElement = glyphInterface.document.createElementNS(svgns, 'g')
          , subscription = init(layerElement, glyphInterface.glyph)
          ;

        subscription.elementMousedown = dragInit.bind(
                            null, glyphInterface.element, subscription);
        glyphInterface.element.addEventListener(
                        'mousedown', subscription.elementMousedown);

        return [layerElement, subscription];
    }

    function destroy (glyphInterface, layerElement, subscription) {
        glyphInterface.element.removeEventListener(
                        'mousedown', subscription.elementMousedown);

        subscription.elements.forEach(function(data, element) {
            var styleDict = element.getComputedStyle();
            styleDict.off(data.subscriptionID);
        });
    }

    return {
        create: create
      , destroy: destroy
    };
});
